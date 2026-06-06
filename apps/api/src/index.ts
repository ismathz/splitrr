import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { createDb, BillSessionRepository, GroupRepository } from "@splitbot/db";
import type { ParsedReceipt, ParsedReceiptAdjustment } from "@splitbot/shared";
import { env } from "./env";
import { StorageService } from "./storage";
import { OpenAiOcrProvider } from "./ocr";
import { allocateCentsByWeight } from "./splitter";

const db = createDb(env.SQLITE_PATH);
const groups = new GroupRepository(db);
const sessions = new BillSessionRepository(db);
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

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.options("/api/*", (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  return c.body(null, 204);
});

app.get("/health", (c) => c.json({ ok: true }));

app.post("/api/bills", async (c) => {
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

  const groupId = groups.upsertGroup(body.telegramChatId, body.groupTitle);
  const billId = randomUUID();

  sessions.create({
    id: billId,
    groupId,
    title: body.title,
    status: "draft",
    createdByUserId: body.createdByUserId,
    billDate: body.billDate,
    place: body.place ?? null,
    currency: body.currency
  });

  return c.json({ billId, groupId });
});

app.post("/api/bills/:billId/receipt", async (c) => {
  const billId = c.req.param("billId");
  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return c.json({ error: "file is required" }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `${billId}/${Date.now()}-${file.name}`;
  const stored = await storage.putObject(key, bytes, file.type || "image/jpeg");
  const signedUrl = await storage.getSignedUrl(stored.key);

  db.query(
    `INSERT INTO receipt_images (id, bill_session_id, storage_key, mime_type, size_bytes, ocr_status)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending')`
  ).run(randomUUID(), billId, stored.key, stored.contentType, stored.sizeBytes);

  sessions.updateStatus(billId, "draft");
  return c.json({ key: stored.key, signedUrl });
});

app.post("/api/bills/:billId/ocr", async (c) => {
  const billId = c.req.param("billId");
  const body = await c.req.json<{ imageUrl: string }>();
  const parsed = await ocr.parseReceiptFromImageUrl(body.imageUrl);
  const validated = validateAndSanitizeParsedReceipt(parsed);
  if (!validated.ok) {
    return c.json({ error: validated.message }, 422);
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

  sessions.updateStatus(billId, "draft");
  return c.json(receipt);
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

app.post("/api/bills/:billId/settlements/compute", (c) => {
  const billId = c.req.param("billId");
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

  const balances = new Map<number, number>();
  const grouped = new Map<string, typeof items>();
  for (const row of items) {
    if (!grouped.has(row.itemId)) grouped.set(row.itemId, []);
    grouped.get(row.itemId)?.push(row);
  }

  for (const rows of grouped.values()) {
    const total = rows[0].totalPriceCents;
    const members = rows
      .filter((r) => r.userId !== null)
      .map((r) => ({ userId: r.userId as number, weight: r.weight ?? 1 }));

    const allocation = allocateCentsByWeight({ itemTotalCents: total, members });
    for (const [userId, owed] of allocation.entries()) {
      balances.set(userId, (balances.get(userId) ?? 0) + owed);
    }
  }

  const debtors: Array<{ userId: number; amount: number }> = [];
  const creditors: Array<{ userId: number; amount: number }> = [];

  for (const [userId, amount] of balances) {
    if (amount > 0) debtors.push({ userId, amount });
    else if (amount < 0) creditors.push({ userId, amount: -amount });
  }

  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const transfer = Math.min(debtor.amount, creditor.amount);

    db.query(
      `INSERT INTO settlements (id, bill_session_id, payer_user_id, payee_user_id, amount_cents)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).run(randomUUID(), billId, debtor.userId, creditor.userId, transfer);

    debtor.amount -= transfer;
    creditor.amount -= transfer;
    if (debtor.amount === 0) i += 1;
    if (creditor.amount === 0) j += 1;
  }

  sessions.updateStatus(billId, "active");
  return c.json({ ok: true });
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

app.post("/api/reminders/run", (c) => {
  const pending = db
    .query(
      `SELECT id, bill_session_id, payer_user_id, payee_user_id, amount_cents
       FROM settlements WHERE status = 'pending'`
    )
    .all();

  for (const row of pending as Array<{ bill_session_id: string } & Record<string, unknown>>) {
    db.query(
      `INSERT INTO activity_events (id, bill_session_id, event_type, payload_json)
       VALUES (?1, ?2, 'reminder_sent', ?3)`
    ).run(randomUUID(), row.bill_session_id, JSON.stringify(row));
  }

  return c.json({ remindersQueued: pending.length });
});

await storage.assertBucketAccess();
serve({ fetch: app.fetch, port: env.PORT });
console.log(`API listening on ${env.PORT}`);
