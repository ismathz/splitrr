import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import {
  createDb,
  BillSessionRepository,
  GroupRepository,
  GroupRosterRepository
} from "@splitbot/db";
import type { ParsedReceipt, ParsedReceiptAdjustment } from "@splitbot/shared";
import { env } from "./env";
import { classifyStorageError, StorageService } from "./storage";
import { OpenAiOcrProvider, toOpenAiImageDataUrl } from "./ocr";
import { requireCronSecret, requireTelegramAuth } from "./auth";
import { RateLimiter } from "./rateLimit";
import { validateReceiptFile } from "./receiptValidation";
import { computeSettlementTransfers } from "./settlement";
import {
  authorizeBillAnnounce,
  buildBillAnnounceOpenUrl,
  formatBillAnnounceMessage,
  type BillAnnounceRow
} from "./announce";
import { authorizeRosterChatAccess } from "./roster";
import { backfillRosterFromBotApi } from "./telegramRosterBackfill";
import { buildTelegramDiag, type TelegramDiag } from "./telegramDiag";
import {
  classifyOpenAiError,
  listRecentPipelineFailures,
  recordPipelineFailure
} from "./pipelineErrors";

const db = createDb(env.SQLITE_PATH);
const groups = new GroupRepository(db);
const roster = new GroupRosterRepository(db);
const sessions = new BillSessionRepository(db);

/** Avoid hammering Telegram when many Mini App clients open the same group. */
const rosterBackfillCooldownMs = 60_000;
const rosterBackfillLastAt = new Map<string, number>();

const storage = new StorageService({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  keyPrefix: env.S3_KEY_PREFIX
});
const ocr = new OpenAiOcrProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);
const OCR_MIN_ITEM_CONFIDENCE = 0.6;

const uploadLimiter = new RateLimiter(20, 20 / 60);
const ocrLimiter = new RateLimiter(10, 10 / 60);

function clientKey(c: { req: { header: (n: string) => string | undefined } }): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

function validateAndSanitizeParsedReceipt(parsed: ParsedReceipt):
  | { ok: true; receipt: ParsedReceipt }
  | { ok: false; message: string } {
  const normalizedRawText = parsed.rawText.trim();
  const normalizedItems = parsed.items
    .map((item) => ({
      ...item,
      name: item.name.trim()
    }))
    .filter((item) => item.name.length > 0)
    .filter((item) => item.confidence >= OCR_MIN_ITEM_CONFIDENCE);

  const discountAdjustments: ParsedReceiptAdjustment[] = normalizedItems
    .filter((item) => item.totalPriceCents < 0 || item.unitPriceCents < 0)
    .map((item) => {
      const derivedAmountCents =
        item.totalPriceCents < 0
          ? item.totalPriceCents
          : Math.round(item.unitPriceCents * item.qty);
      return {
        name: item.name,
        amountCents:
          derivedAmountCents < 0
            ? derivedAmountCents
            : -Math.abs(derivedAmountCents),
        confidence: item.confidence
      };
    });

  const filteredItems = normalizedItems
    .filter((item) => Number.isFinite(item.qty) && item.qty > 0)
    .filter((item) => item.unitPriceCents >= 0)
    .filter((item) => item.totalPriceCents > 0)
    .filter((item) => item.confidence >= OCR_MIN_ITEM_CONFIDENCE);

  if (!normalizedRawText && (filteredItems.length > 0 || discountAdjustments.length > 0)) {
    return {
      ok: false,
      message:
        "Receipt looks unreadable. Please upload a clearer image with visible text."
    };
  }

  return {
    ok: true,
    receipt: {
      ...parsed,
      rawText: normalizedRawText,
      items: filteredItems,
      discountAdjustments
    }
  };
}

const app = new Hono();

const corsOrigin = env.TELEGRAM_WEBAPP_URL
  ? env.TELEGRAM_WEBAPP_URL.replace(/\/$/, "")
  : env.SPLITBOT_DEV_AUTH_BYPASS
    ? "*"
    : undefined;

app.use(
  "/api/*",
  cors({
    origin: corsOrigin ?? "http://localhost:5173",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Telegram-Init-Data",
      "X-Cron-Secret"
    ],
    credentials: false
  })
);

app.onError((err, c) => {
  console.error("[api]", err);
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  const storageHit =
    /S3|NoSuchBucket|AccessDenied|checksum|ECONNREFUSED|ENOTFOUND|storage_/i.test(
      `${name} ${message}`
    );
  const openaiHit = /OpenAI|openai|invalid_image|Timeout while downloading/i.test(
    `${name} ${message}`
  );
  const code = storageHit
    ? "storage_uncaught"
    : openaiHit
      ? "openai_uncaught"
      : "internal_error";
  const userMessage = storageHit
    ? "Receipt storage failed unexpectedly. Check S3/R2 env and /api/pipeline/last-failures."
    : openaiHit
      ? "Receipt OCR failed unexpectedly. Check OPENAI_API_KEY / model and retry as JPEG/PNG."
      : "Something went wrong while processing the receipt.";

  try {
    recordPipelineFailure({
      stage: c.req.path.includes("/ocr")
        ? "ocr"
        : c.req.path.includes("/receipt")
          ? "upload"
          : "create_bill",
      path: c.req.path,
      code,
      message: userMessage,
      httpStatus: 500
    });
  } catch {
    /* ignore dig ring failures */
  }

  return c.json(
    {
      error: "internal_error",
      code,
      message: userMessage
    },
    500
  );
});

let telegramDiagCache: TelegramDiag | null = null;
let telegramDiagLoadedAt = 0;

async function getTelegramDiagCached(): Promise<TelegramDiag> {
  const now = Date.now();
  if (telegramDiagCache && now - telegramDiagLoadedAt < 60_000) {
    return telegramDiagCache;
  }
  telegramDiagCache = await buildTelegramDiag({
    botToken: env.TELEGRAM_BOT_TOKEN,
    expectedUsername: env.TELEGRAM_BOT_USERNAME
  });
  telegramDiagLoadedAt = now;
  console.info("[api] telegram diag", {
    gitSha: telegramDiagCache.gitSha,
    hmacAlgo: telegramDiagCache.hmacAlgo,
    botId: telegramDiagCache.token.botId,
    tokenSuffix: telegramDiagCache.token.tokenSuffix,
    getMe: telegramDiagCache.getMe,
    tokenMatchesExpectedBot: telegramDiagCache.tokenMatchesExpectedBot
  });
  return telegramDiagCache;
}

// Warm diag at boot (non-blocking).
void getTelegramDiagCached().catch((err) =>
  console.warn("[api] telegram diag warm failed", err)
);

async function healthPayload() {
  const telegram = await getTelegramDiagCached();
  const openaiKey = env.OPENAI_API_KEY?.trim() ?? "";
  return {
    ok: true as const,
    service: "api",
    gitSha: telegram.gitSha,
    hmacAlgo: telegram.hmacAlgo,
    telegram: {
      botId: telegram.token.botId,
      tokenSuffix: telegram.token.tokenSuffix,
      expectedUsername: telegram.expectedUsername,
      getMeUsername: telegram.getMe.username ?? null,
      getMeId: telegram.getMe.id ?? null,
      getMeOk: telegram.getMe.ok,
      getMeError: telegram.getMe.error ?? null,
      tokenMatchesExpectedBot: telegram.tokenMatchesExpectedBot
    },
    openai: {
      keyConfigured: openaiKey.length > 0,
      keySuffix: openaiKey ? openaiKey.slice(-4) : null,
      model: env.OPENAI_MODEL
    },
    storage: {
      endpointHost: (() => {
        try {
          return new URL(env.S3_ENDPOINT).host;
        } catch {
          return null;
        }
      })(),
      bucket: env.S3_BUCKET,
      keyPrefix: env.S3_KEY_PREFIX
    }
  };
}

// Local / direct :3000. Public tunnel often maps bare `/health` to the bot.
app.get("/health", async (c) => c.json(await healthPayload()));

app.use("/api/reminders/*", requireCronSecret);
app.use("/api/*", async (c, next) => {
  // Public dig endpoints (tunnel routes `/api/*` → API; bare `/health` hits bot).
  if (
    c.req.path === "/api/health" ||
    c.req.path === "/api/auth/last-failures" ||
    c.req.path === "/api/pipeline/last-failures" ||
    c.req.path.startsWith("/api/reminders/")
  ) {
    return next();
  }
  return requireTelegramAuth(c, next);
});

app.get("/api/health", async (c) => c.json(await healthPayload()));

/** Temporary: last initData auth failures (reasons/shape only — no secrets). */
app.get("/api/auth/last-failures", async (c) => {
  const { listRecentAuthFailures } = await import("./authFailureDebug");
  return c.json({
    ok: true,
    hmacAlgo: (await getTelegramDiagCached()).hmacAlgo,
    failures: listRecentAuthFailures()
  });
});

/** Temporary: last receipt upload/OCR failures (codes only — no image bytes/secrets). */
app.get("/api/pipeline/last-failures", (c) =>
  c.json({
    ok: true,
    failures: listRecentPipelineFailures()
  })
);

app.post("/api/bills", async (c) => {
  try {
    const body = await c.req.json<{
      telegramChatId: string;
      groupTitle: string;
      title: string;
      createdByUserId?: number;
      /** ISO date YYYY-MM-DD */
      billDate?: string;
      place?: string | null;
      /** ISO 4217 code for manual / empty bills (defaults to USD). */
      currency?: string;
    }>();

    if (!body?.telegramChatId?.trim() || !body?.title?.trim()) {
      return c.json(
        {
          error: "telegramChatId and title are required",
          code: "invalid_bill_body"
        },
        400
      );
    }

    const groupId = groups.upsertGroup(
      body.telegramChatId,
      body.groupTitle?.trim() || "Group"
    );
    const billId = randomUUID();
    const authUser = c.get("telegramUser");

    sessions.create({
      id: billId,
      groupId,
      title: body.title,
      status: "draft",
      createdByUserId: body.createdByUserId ?? authUser?.id,
      billDate: body.billDate,
      place: body.place ?? null,
      currency: body.currency
    });

    return c.json({ billId, groupId });
  } catch (err) {
    console.error("[create-bill]", err);
    recordPipelineFailure({
      stage: "create_bill",
      path: c.req.path,
      code: "create_bill_failed",
      message: "Could not create the bill session.",
      httpStatus: 500
    });
    return c.json(
      {
        error: "Could not create the bill session. Try again.",
        code: "create_bill_failed"
      },
      500
    );
  }
});

app.post("/api/bills/:billId/receipt", async (c) => {
  if (!uploadLimiter.take(`upload:${clientKey(c)}`)) {
    return c.json({ error: "rate_limited" }, 429);
  }

  const billId = c.req.param("billId");
  // Auth middleware may have already parsed multipart to read initData.
  const cached = c.get("parsedMultipart");
  let file: unknown = cached?.file ?? null;
  if (!(file instanceof File)) {
    try {
      const formData = await c.req.formData();
      file = formData.get("file");
    } catch (err) {
      console.warn("[api] receipt formData read failed", err);
      file = null;
    }
  }

  if (!(file instanceof File)) {
    return c.json({ error: "file is required", code: "file_required" }, 400);
  }

  const validatedFile = validateReceiptFile(file);
  if (!validatedFile.ok) {
    return c.json(
      { error: validatedFile.message, code: "invalid_receipt_file" },
      400
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const safeName = (file.name || "receipt.jpg").replace(/[^\w.\-]+/g, "_");
    const key = `${billId}/${Date.now()}-${safeName}`;
    const stored = await storage.putObject(key, bytes, validatedFile.mime);
    const signedUrl = await storage.getSignedUrl(stored.key);

    db.query(
      `INSERT INTO receipt_images (id, bill_session_id, storage_key, mime_type, size_bytes, ocr_status)
       VALUES (?1, ?2, ?3, ?4, ?5, 'pending')`
    ).run(
      randomUUID(),
      billId,
      stored.key,
      stored.contentType,
      stored.sizeBytes
    );

    sessions.updateStatus(billId, "draft");
    return c.json({ key: stored.key, signedUrl });
  } catch (err) {
    const classified = classifyStorageError(err);
    console.error("[receipt-upload]", classified.code, err);
    recordPipelineFailure({
      stage: "upload",
      path: c.req.path,
      code: classified.code,
      message: classified.message,
      httpStatus: classified.status,
      mime: validatedFile.mime,
      sizeBytes: file.size
    });
    return c.json(
      {
        error: classified.message,
        code: classified.code
      },
      classified.status as 502
    );
  }
});

app.post("/api/bills/:billId/ocr", async (c) => {
  if (!ocrLimiter.take(`ocr:${clientKey(c)}`)) {
    return c.json({ error: "rate_limited" }, 429);
  }

  const billId = c.req.param("billId");
  let body: { storageKey?: string; imageUrl?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  let storageKey = typeof body.storageKey === "string" ? body.storageKey.trim() : "";
  if (!storageKey) {
    const latest = db
      .query(
        `SELECT storage_key FROM receipt_images
         WHERE bill_session_id = ?1
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(billId) as { storage_key: string } | null;
    storageKey = latest?.storage_key ?? "";
  }

  if (!storageKey || !storage.isOwnedKey(storageKey)) {
    return c.json(
      {
        error:
          "Upload a receipt first. OCR only accepts storageKey from this environment (imageUrl is not allowed).",
        code: "missing_storage_key"
      },
      400
    );
  }

  const receiptRow = db
    .query(
      `SELECT id, mime_type FROM receipt_images
       WHERE bill_session_id = ?1 AND storage_key = ?2
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(billId, storageKey) as { id: string; mime_type: string } | null;

  try {
    // Pull bytes from R2 ourselves and send a data URL. OpenAI frequently fails
    // to fetch private R2/S3 signed URLs (Timeout while downloading / invalid_image_url).
    const object = await storage.getObjectBytes(storageKey);
    const mime = receiptRow?.mime_type || object.contentType;
    const dataUrl = toOpenAiImageDataUrl(object.bytes, mime);
    if (!dataUrl.ok) {
      if (receiptRow) {
        db.query(
          `UPDATE receipt_images SET ocr_status = 'failed' WHERE id = ?1`
        ).run(receiptRow.id);
      }
      recordPipelineFailure({
        stage: "ocr",
        path: c.req.path,
        code: "unsupported_ocr_mime",
        message: dataUrl.message,
        httpStatus: 422,
        mime
      });
      return c.json(
        { error: dataUrl.message, code: "unsupported_ocr_mime" },
        422
      );
    }

    const parsed = await ocr.parseReceiptFromImageUrl(dataUrl.dataUrl);
    const validated = validateAndSanitizeParsedReceipt(parsed);
    if (!validated.ok) {
      if (receiptRow) {
        db.query(
          `UPDATE receipt_images SET ocr_status = 'failed' WHERE id = ?1`
        ).run(receiptRow.id);
      }
      recordPipelineFailure({
        stage: "ocr",
        path: c.req.path,
        code: "ocr_unreadable",
        message: validated.message,
        httpStatus: 422,
        mime
      });
      return c.json(
        { error: validated.message, code: "ocr_unreadable" },
        422
      );
    }

    const receipt = validated.receipt;
    sessions.updateCurrency(billId, receipt.currency);

    for (const item of receipt.items) {
      db.query(
        `INSERT INTO bill_items (id, bill_session_id, name, qty, unit_price_cents, total_price_cents, confidence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      ).run(
        randomUUID(),
        billId,
        item.name,
        item.qty,
        item.unitPriceCents,
        item.totalPriceCents,
        item.confidence
      );
    }

    if (receipt.taxCents) {
      db.query(
        `INSERT INTO charges (id, bill_session_id, charge_type, amount_cents) VALUES (?1, ?2, 'tax', ?3)`
      ).run(randomUUID(), billId, receipt.taxCents);
    }

    if (receipt.tipCents) {
      db.query(
        `INSERT INTO charges (id, bill_session_id, charge_type, amount_cents) VALUES (?1, ?2, 'tip', ?3)`
      ).run(randomUUID(), billId, receipt.tipCents);
    }

    for (const discount of receipt.discountAdjustments ?? []) {
      db.query(
        `INSERT INTO charges (id, bill_session_id, charge_type, amount_cents) VALUES (?1, ?2, 'discount', ?3)`
      ).run(randomUUID(), billId, discount.amountCents);
    }

    if (receiptRow) {
      db.query(
        `UPDATE receipt_images SET ocr_status = 'done' WHERE id = ?1`
      ).run(receiptRow.id);
    }

    sessions.updateStatus(billId, "draft");
    return c.json(receipt);
  } catch (err) {
    try {
      if (receiptRow) {
        db.query(
          `UPDATE receipt_images SET ocr_status = 'failed' WHERE id = ?1`
        ).run(receiptRow.id);
      }
    } catch (markErr) {
      console.warn("[ocr] failed to mark receipt failed", markErr);
    }

    // Prefer storage classification when GetObject failed; else OpenAI.
    const errObj = err as {
      name?: string;
      message?: string;
      Code?: string;
      $metadata?: { httpStatusCode?: number };
      status?: number;
    };
    const isStorageErr = Boolean(
      errObj?.$metadata ||
        /S3|NoSuchKey|NotFound|AccessDenied|storage_/i.test(
          `${errObj?.name ?? ""} ${errObj?.Code ?? ""} ${errObj?.message ?? ""}`
        )
    );
    const classified = isStorageErr
      ? {
          ...classifyStorageError(err),
          openaiStatus: undefined as number | undefined,
          openaiCode: undefined as string | undefined
        }
      : classifyOpenAiError(err);

    console.error("[ocr]", classified.code, err);
    try {
      recordPipelineFailure({
        stage: "ocr",
        path: c.req.path,
        code: classified.code,
        message: classified.message,
        httpStatus: classified.status,
        openaiStatus: classified.openaiStatus,
        openaiCode: classified.openaiCode,
        mime: receiptRow?.mime_type
      });
    } catch {
      /* ignore */
    }
    return c.json(
      {
        error: classified.message,
        code: classified.code,
        openaiStatus: classified.openaiStatus ?? null,
        openaiCode: classified.openaiCode ?? null
      },
      classified.status as 502
    );
  }
});

app.post("/api/bills/:billId/assignments", async (c) => {
  const billId = c.req.param("billId");
  const body = await c.req.json<{
    itemId: string;
    members: Array<{ userId: number; weight: number }>;
  }>();

  db.query("DELETE FROM item_assignments WHERE bill_item_id = ?1").run(body.itemId);

  for (const member of body.members) {
    db.query(
      `INSERT INTO item_assignments (id, bill_item_id, user_id, weight) VALUES (?1, ?2, ?3, ?4)`
    ).run(randomUUID(), body.itemId, member.userId, member.weight);
  }

  db.query(
    `INSERT INTO activity_events (id, bill_session_id, event_type, payload_json)
     VALUES (?1, ?2, 'item_assigned', json_object('itemId', ?3))`
  ).run(randomUUID(), billId, body.itemId);

  return c.json({ ok: true });
});

app.get("/api/bills/:billId", (c) => {
  const billId = c.req.param("billId");
  const session = db
    .query(
      `SELECT id, title, status, currency, bill_date, place
       FROM bill_sessions
       WHERE id = ?1`
    )
    .get(billId) as
    | {
        id: string;
        title: string;
        status: string;
        currency: string;
        bill_date: string;
        place: string | null;
      }
    | null;

  if (!session) {
    return c.json({ error: "Bill not found" }, 404);
  }

  const items = db
    .query(
      `SELECT id, name, total_price_cents
       FROM bill_items
       WHERE bill_session_id = ?1
       ORDER BY created_at ASC`
    )
    .all(billId) as Array<{
    id: string;
    name: string;
    total_price_cents: number;
  }>;

  return c.json({
    id: session.id,
    title: session.title,
    status: session.status,
    currency: session.currency,
    billDate: session.bill_date,
    place: session.place,
    settled: session.status === "settled",
    items: items.map((item) => {
      const assignees = db
        .query(
          `SELECT COALESCE(NULLIF(trim(u.first_name), ''), NULLIF(trim(u.username), ''), u.telegram_user_id) AS display_name
           FROM item_assignments a
           JOIN users u ON u.id = a.user_id
           WHERE a.bill_item_id = ?1
           ORDER BY a.created_at ASC`
        )
        .all(item.id) as Array<{ display_name: string | null }>;
      return {
        id: item.id,
        name: item.name,
        totalPriceCents: item.total_price_cents,
        assignees: assignees
          .map((a) => a.display_name?.trim() ?? "")
          .filter(Boolean),
      };
    }),
  });
});

app.patch("/api/bills/:billId", async (c) => {
  const billId = c.req.param("billId");
  const body = await c.req.json<{
    title?: string;
    billDate?: string;
    place?: string | null;
    items?: Array<{
      id?: string;
      name: string;
      totalPriceCents: number;
      assignees?: string[];
    }>;
  }>();
  const nextTitle = body.title?.trim();
  if (!nextTitle) {
    return c.json({ error: "title is required" }, 400);
  }

  const exists = db
    .query("SELECT id FROM bill_sessions WHERE id = ?1")
    .get(billId) as { id: string } | null;
  if (!exists) {
    return c.json({ error: "Bill not found" }, 404);
  }

  db.query(
    `UPDATE bill_sessions
     SET title = ?2,
         bill_date = COALESCE(?3, bill_date),
         place = CASE WHEN ?4 = '__KEEP__' THEN place ELSE NULLIF(?4, '') END,
         updated_at = datetime('now')
     WHERE id = ?1`
  ).run(
    billId,
    nextTitle,
    body.billDate?.trim() || null,
    body.place === undefined ? "__KEEP__" : (body.place?.trim() ?? ""),
  );

  if (Array.isArray(body.items)) {
    db.query("DELETE FROM bill_items WHERE bill_session_id = ?1").run(billId);
    const sessionMeta = db
      .query("SELECT group_id FROM bill_sessions WHERE id = ?1")
      .get(billId) as { group_id: number } | null;
    const groupId = sessionMeta?.group_id ?? null;
    const upsertUserByName = db.query(
      `INSERT INTO users (telegram_user_id, first_name)
       VALUES (?1, ?2)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         first_name = excluded.first_name
       RETURNING id`
    );
    const getUserByTelegramId = db.query(
      "SELECT id FROM users WHERE telegram_user_id = ?1"
    );
    const upsertGroupMember = db.query(
      `INSERT OR IGNORE INTO group_members (group_id, user_id)
       VALUES (?1, ?2)`
    );
    const insertAssignment = db.query(
      `INSERT OR IGNORE INTO item_assignments (id, bill_item_id, user_id, weight)
       VALUES (?1, ?2, ?3, 1)`
    );

    for (const item of body.items) {
      const name = item.name?.trim();
      const total = Number(item.totalPriceCents);
      if (!name || !Number.isFinite(total) || total <= 0) continue;
      const itemId = item.id ?? randomUUID();
      db.query(
        `INSERT INTO bill_items (id, bill_session_id, name, qty, unit_price_cents, total_price_cents, confidence)
         VALUES (?1, ?2, ?3, 1, ?4, ?4, 1)`
      ).run(itemId, billId, name, Math.round(total));

      for (const rawAssignee of item.assignees ?? []) {
        const assigneeName = rawAssignee.trim();
        if (!assigneeName) continue;
        const syntheticTelegramUserId = `name:${assigneeName.toLowerCase()}`;
        const inserted = upsertUserByName.get(
          syntheticTelegramUserId,
          assigneeName
        ) as { id: number } | null;
        const existing = getUserByTelegramId.get(syntheticTelegramUserId) as
          | { id: number }
          | null;
        const userId = inserted?.id ?? existing?.id;
        if (!userId) continue;
        if (groupId != null) {
          upsertGroupMember.run(groupId, userId);
        }
        insertAssignment.run(randomUUID(), itemId, userId);
      }
    }
  }

  return c.json({ ok: true });
});

app.delete("/api/bills/:billId", (c) => {
  const billId = c.req.param("billId");
  const deleted = db
    .query("DELETE FROM bill_sessions WHERE id = ?1")
    .run(billId);

  if (!deleted.changes) {
    return c.json({ error: "Bill not found" }, 404);
  }

  return c.json({ ok: true });
});

app.post("/api/bills/:billId/announce", async (c) => {
  const billId = c.req.param("billId");
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return c.json({ error: "TELEGRAM_BOT_TOKEN required for announce" }, 503);
  }

  const bill = db
    .query(
      `SELECT bs.id AS billId, bs.title AS title, bs.status AS status,
              bs.currency AS currency, bs.bill_date AS billDate, bs.place AS place,
              g.telegram_chat_id AS telegramChatId
       FROM bill_sessions bs
       JOIN groups g ON g.id = bs.group_id
       WHERE bs.id = ?1`
    )
    .get(billId) as BillAnnounceRow | null;

  if (!bill) {
    return c.json({ error: "Bill not found" }, 404);
  }

  if (!bill.telegramChatId?.trim()) {
    return c.json({ error: "group_chat_missing" }, 400);
  }

  const authUser = c.get("telegramUser");
  const auth = authorizeBillAnnounce(bill, {
    authMode: c.get("authMode"),
    initData: c.get("initData"),
    telegramUserId: authUser?.id ?? null
  });
  if (!auth.ok) {
    return c.json({ error: auth.error }, auth.status);
  }

  const totals = db
    .query(
      `SELECT COUNT(*) AS itemCount,
              COALESCE(SUM(total_price_cents), 0) AS totalCents
       FROM bill_items
       WHERE bill_session_id = ?1`
    )
    .get(billId) as { itemCount: number; totalCents: number };

  const openUrl = buildBillAnnounceOpenUrl({
    botUsername: env.TELEGRAM_BOT_USERNAME,
    shortName: env.TELEGRAM_MINI_APP_SHORT_NAME,
    telegramChatId: bill.telegramChatId
  });

  const text = formatBillAnnounceMessage(bill, {
    itemCount: Number(totals.itemCount) || 0,
    totalCents: Number(totals.totalCents) || 0,
    openUrl
  });

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: bill.telegramChatId,
        text,
        disable_web_page_preview: true
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("[announce]", bill.telegramChatId, errText);
      db.query(
        `INSERT INTO activity_events (id, bill_session_id, event_type, payload_json)
         VALUES (?1, ?2, 'announce_failed', ?3)`
      ).run(
        randomUUID(),
        billId,
        JSON.stringify({ status: res.status, body: errText.slice(0, 500) })
      );
      return c.json({ error: "telegram_send_failed" }, 502);
    }

    db.query(
      `INSERT INTO activity_events (id, bill_session_id, event_type, payload_json)
       VALUES (?1, ?2, 'announce_sent', ?3)`
    ).run(
      randomUUID(),
      billId,
      JSON.stringify({
        telegramChatId: bill.telegramChatId,
        byUserId: authUser?.id ?? null
      })
    );

    return c.json({ ok: true, openUrl });
  } catch (err) {
    console.error("[announce]", err);
    return c.json({ error: "telegram_send_failed" }, 502);
  }
});

app.post("/api/bills/:billId/settlements/compute", async (c) => {
  const billId = c.req.param("billId");
  let body: { paidByUserId?: number } = {};
  try {
    body = await c.req.json<{ paidByUserId?: number }>();
  } catch {
    body = {};
  }
  const authUser = c.get("telegramUser");
  const paidByUserId =
    typeof body.paidByUserId === "number" && Number.isFinite(body.paidByUserId)
      ? body.paidByUserId
      : authUser?.id;

  if (typeof paidByUserId !== "number" || !Number.isFinite(paidByUserId)) {
    return c.json(
      { error: "paidByUserId is required (who paid the merchant)" },
      400
    );
  }

  // Resolve Telegram user id → internal users.id when needed
  let payerInternalId = paidByUserId;
  const byPk = db
    .query("SELECT id FROM users WHERE id = ?1")
    .get(paidByUserId) as { id: number } | null;
  if (!byPk) {
    const byTg = db
      .query("SELECT id FROM users WHERE telegram_user_id = ?1")
      .get(String(paidByUserId)) as { id: number } | null;
    if (byTg) {
      payerInternalId = byTg.id;
    } else {
      const inserted = db
        .query(
          `INSERT INTO users (telegram_user_id, first_name)
           VALUES (?1, ?2)
           RETURNING id`
        )
        .get(String(paidByUserId), authUser?.first_name ?? "Payer") as {
        id: number;
      };
      payerInternalId = inserted.id;
    }
  }

  db.query("DELETE FROM settlements WHERE bill_session_id = ?1").run(billId);

  const items = db
    .query(
      `SELECT i.id AS itemId, i.total_price_cents AS totalPriceCents,
              a.user_id AS userId, a.weight AS weight
       FROM bill_items i
       LEFT JOIN item_assignments a ON a.bill_item_id = i.id
       WHERE i.bill_session_id = ?1`
    )
    .all(billId) as Array<{
    itemId: string;
    totalPriceCents: number;
    userId: number | null;
    weight: number | null;
  }>;

  const charges = db
    .query(
      `SELECT amount_cents AS amountCents FROM charges WHERE bill_session_id = ?1`
    )
    .all(billId) as Array<{ amountCents: number }>;

  const transfers = computeSettlementTransfers({
    items,
    charges,
    paidByUserId: payerInternalId
  });

  for (const t of transfers) {
    db.query(
      `INSERT INTO settlements (id, bill_session_id, payer_user_id, payee_user_id, amount_cents)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).run(randomUUID(), billId, t.payerUserId, t.payeeUserId, t.amountCents);
  }

  sessions.updateStatus(billId, "active");
  return c.json({ ok: true, transfers: transfers.length });
});

app.post("/api/settlements/:settlementId/paid", (c) => {
  const settlementId = c.req.param("settlementId");
  const settlement = db
    .query("SELECT bill_session_id FROM settlements WHERE id = ?1")
    .get(settlementId) as { bill_session_id: string } | null;

  db.query(
    `UPDATE settlements SET status = 'paid', updated_at = datetime('now') WHERE id = ?1`
  ).run(settlementId);

  if (settlement) {
    const pending = db
      .query(
        `SELECT COUNT(*) as count
         FROM settlements
         WHERE bill_session_id = ?1 AND status != 'paid'`
      )
      .get(settlement.bill_session_id) as { count: number };

    if (pending.count === 0) {
      sessions.updateStatus(settlement.bill_session_id, "settled");
    }
  }

  return c.json({ ok: true });
});

app.get("/api/bills/:billId/payment-status", (c) => {
  const billId = c.req.param("billId");
  const membersFromAssignments = db
    .query(
      `SELECT
         COALESCE(NULLIF(trim(u.first_name), ''), NULLIF(trim(u.username), ''), u.telegram_user_id) AS display_name,
         MIN(a.created_at) AS first_assigned_at
       FROM bill_items i
       JOIN item_assignments a ON a.bill_item_id = i.id
       JOIN users u ON u.id = a.user_id
       WHERE i.bill_session_id = ?1
       GROUP BY display_name
       ORDER BY first_assigned_at ASC`
    )
    .all(billId) as Array<{
    display_name: string | null;
    first_assigned_at: string;
  }>;

  const paymentRows = db
    .query(
      `SELECT member_name, paid
       FROM bill_member_payment_status
       WHERE bill_session_id = ?1`
    )
    .all(billId) as Array<{ member_name: string; paid: number }>;
  const paidByName = new Map<string, boolean>();
  for (const row of paymentRows) {
    const name = row.member_name.trim();
    if (!name) continue;
    paidByName.set(name, row.paid === 1);
  }

  const orderedNames: string[] = [];
  const seen = new Set<string>();
  for (const row of membersFromAssignments) {
    const name = row.display_name?.trim() ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    orderedNames.push(name);
  }
  for (const row of paymentRows) {
    const name = row.member_name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    orderedNames.push(name);
  }

  return c.json({
    members: orderedNames.map((name) => ({
      name,
      paid: paidByName.get(name) ?? false,
    })),
    /** Honor-system checklist — not payment-processor settlement. */
    trackingMode: "manual_checklist" as const,
  });
});

app.post("/api/bills/:billId/payment-status", async (c) => {
  const billId = c.req.param("billId");
  const body = await c.req.json<{ name?: string; paid?: boolean }>();
  const name = body.name?.trim() ?? "";
  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }
  if (typeof body.paid !== "boolean") {
    return c.json({ error: "paid must be boolean" }, 400);
  }

  const exists = db
    .query(
      "SELECT id FROM bill_sessions WHERE id = ?1"
    )
    .get(billId) as { id: string } | null;
  if (!exists) {
    return c.json({ error: "Bill not found" }, 404);
  }

  db.query(
    `INSERT INTO bill_member_payment_status (id, bill_session_id, member_name, paid)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(bill_session_id, member_name) DO UPDATE SET
       paid = excluded.paid,
       updated_at = datetime('now')`
  ).run(randomUUID(), billId, name, body.paid ? 1 : 0);

  const settlementCounts = db
    .query(
      `SELECT
         COUNT(*) as total_count,
         SUM(CASE WHEN status != 'paid' THEN 1 ELSE 0 END) as pending_count
       FROM settlements
       WHERE bill_session_id = ?1`
    )
    .get(billId) as { total_count: number; pending_count: number | null };

  // Keep bill status in sync only when settlement records exist.
  if (settlementCounts.total_count > 0) {
    const pendingCount = Number(settlementCounts.pending_count ?? 0);
    if (pendingCount === 0) {
      sessions.updateStatus(billId, "settled");
    } else {
      sessions.updateStatus(billId, "active");
    }
  }

  return c.json({ ok: true });
});

app.get("/api/groups/:groupId/history", (c) => {
  const groupId = c.req.param("groupId");
  const createdByUserIdRaw = c.req.query("createdByUserId");
  const createdByUserId = createdByUserIdRaw
    ? Number(createdByUserIdRaw)
    : null;
  const rows = db
    .query(
      `SELECT id, title, status, currency, bill_date, place, created_at
       FROM bill_sessions
       WHERE group_id = ?1
         AND (?2 IS NULL OR created_by_user_id = ?2)
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all(Number(groupId), Number.isFinite(createdByUserId) ? createdByUserId : null);
  return c.json({ bills: rows });
});

app.get("/api/groups/by-telegram-chat/:telegramChatId/history", (c) => {
  const telegramChatId = c.req.param("telegramChatId");
  const createdByUserIdRaw = c.req.query("createdByUserId");
  const createdByUserId = createdByUserIdRaw
    ? Number(createdByUserIdRaw)
    : null;

  const group = db
    .query("SELECT id FROM groups WHERE telegram_chat_id = ?1")
    .get(telegramChatId) as { id: number } | null;

  if (!group) {
    return c.json({ bills: [] });
  }

  const rows = db
    .query(
      `SELECT id, title, status, currency, bill_date, place, created_at
       FROM bill_sessions
       WHERE group_id = ?1
         AND (?2 IS NULL OR created_by_user_id = ?2)
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all(group.id, Number.isFinite(createdByUserId) ? createdByUserId : null);

  return c.json({ bills: rows });
});

/**
 * Stored group roster for Mini App add-members (pick from list).
 * Built from bot-visible users + Mini App openers; not a full Telegram member list.
 * Opening this endpoint upserts the authenticated initData user into the roster
 * and opportunistically backfills admins via Bot API when the roster is thin.
 */
app.get("/api/groups/by-telegram-chat/:telegramChatId/roster", async (c) => {
  const telegramChatId = c.req.param("telegramChatId")?.trim();
  if (!telegramChatId) {
    return c.json({ error: "missing_telegram_chat_id" }, 400);
  }

  const auth = authorizeRosterChatAccess({
    initData: c.get("initData"),
    telegramChatId
  });
  if (!auth.ok) {
    return c.json({ error: auth.error }, auth.status);
  }

  const groupId = groups.upsertGroup(telegramChatId, "Group");
  const authUser = c.get("telegramUser");
  if (authUser?.id != null) {
    roster.observeTelegramUser(groupId, {
      id: authUser.id,
      username: authUser.username,
      first_name: authUser.first_name,
      last_name: authUser.last_name,
      photo_url: authUser.photo_url
    });
  }

  let members = roster.listMembers(groupId);
  let group = groups.findByTelegramChatId(telegramChatId);
  let backfillError: string | undefined;
  const forceRefresh = c.req.query("refresh") === "1";
  const needsBackfill =
    forceRefresh ||
    members.length <= 1 ||
    group?.member_count == null;

  if (needsBackfill && env.TELEGRAM_BOT_TOKEN) {
    const last = rosterBackfillLastAt.get(telegramChatId) ?? 0;
    const due = forceRefresh || Date.now() - last >= rosterBackfillCooldownMs;
    if (due) {
      rosterBackfillLastAt.set(telegramChatId, Date.now());
      const result = await backfillRosterFromBotApi({
        botToken: env.TELEGRAM_BOT_TOKEN,
        telegramChatId,
        groupId,
        groups,
        roster
      });
      backfillError = result.error;
      if (result.error) {
        console.warn(
          "[roster] bot API backfill",
          telegramChatId,
          result.error
        );
      }
      members = roster.listMembers(groupId);
      group = groups.findByTelegramChatId(telegramChatId);
    }
  }

  const seenCount = members.length;
  const memberCount =
    group?.member_count != null && Number.isFinite(group.member_count)
      ? group.member_count
      : null;
  const unseenCount =
    memberCount != null ? Math.max(0, memberCount - seenCount) : null;

  return c.json({
    members: members.map((m) => ({
      tgUserId: m.tgUserId,
      name: m.name,
      username: m.username,
      photoUrl: m.photoUrl
    })),
    memberCount,
    seenCount,
    unseenCount,
    backfillError: backfillError ?? null
  });
});

app.get("/api/bills/:billId/export.csv", (c) => {
  const billId = c.req.param("billId");
  const rows = db
    .query(
      `SELECT i.name, i.qty, i.unit_price_cents, i.total_price_cents
       FROM bill_items i
       WHERE i.bill_session_id = ?1`
    )
    .all(billId) as Array<{
    name: string;
    qty: number;
    unit_price_cents: number;
    total_price_cents: number;
  }>;

  const header = "name,qty,unit_price_cents,total_price_cents";
  const lines = rows.map((r) =>
    [r.name, r.qty, r.unit_price_cents, r.total_price_cents]
      .map((v) => `\"${String(v).replaceAll("\"", "\"\"")}\"`)
      .join(",")
  );

  return c.text([header, ...lines].join("\n"), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename=\"bill-${billId}.csv\"`
  });
});

app.post("/api/reminders/run", async (c) => {
  const pending = db
    .query(
      `SELECT s.id, s.bill_session_id, s.payer_user_id, s.payee_user_id, s.amount_cents,
              pu.telegram_user_id AS payer_tg,
              pe.telegram_user_id AS payee_tg,
              bs.title AS bill_title,
              bs.currency AS currency
       FROM settlements s
       JOIN users pu ON pu.id = s.payer_user_id
       JOIN users pe ON pe.id = s.payee_user_id
       JOIN bill_sessions bs ON bs.id = s.bill_session_id
       WHERE s.status = 'pending'`
    )
    .all() as Array<{
    id: string;
    bill_session_id: string;
    payer_user_id: number;
    payee_user_id: number;
    amount_cents: number;
    payer_tg: string;
    payee_tg: string;
    bill_title: string;
    currency: string;
  }>;

  let sent = 0;
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return c.json({ error: "TELEGRAM_BOT_TOKEN required for reminders" }, 503);
  }

  for (const row of pending) {
    const amount = (row.amount_cents / 100).toFixed(2);
    const text =
      `Splitbot reminder: you still owe ${row.currency} ${amount} ` +
      `for “${row.bill_title}”. Mark paid in the Mini App when settled.`;

    const chatId = row.payer_tg;
    // Skip synthetic name: users
    if (!chatId || chatId.startsWith("name:") || chatId.startsWith("web-")) {
      db.query(
        `INSERT INTO activity_events (id, bill_session_id, event_type, payload_json)
         VALUES (?1, ?2, 'reminder_skipped', ?3)`
      ).run(
        randomUUID(),
        row.bill_session_id,
        JSON.stringify({ settlementId: row.id, reason: "non_telegram_user" })
      );
      continue;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_notification: false
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("[reminder]", chatId, errText);
        db.query(
          `INSERT INTO activity_events (id, bill_session_id, event_type, payload_json)
           VALUES (?1, ?2, 'reminder_failed', ?3)`
        ).run(
          randomUUID(),
          row.bill_session_id,
          JSON.stringify({ settlementId: row.id, status: res.status })
        );
        continue;
      }
      sent += 1;
      db.query(
        `INSERT INTO activity_events (id, bill_session_id, event_type, payload_json)
         VALUES (?1, ?2, 'reminder_sent', ?3)`
      ).run(
        randomUUID(),
        row.bill_session_id,
        JSON.stringify({ settlementId: row.id, payer_tg: chatId })
      );
    } catch (err) {
      console.error("[reminder]", err);
    }
  }

  return c.json({ remindersQueued: pending.length, remindersSent: sent });
});

await storage.assertBucketAccess();
serve({ fetch: app.fetch, port: env.PORT });
console.log(`API listening on ${env.PORT}`);
