import { chatMembers, type ChatMembersFlavor } from "@grammyjs/chat-members";
import { Bot, type Context, webhookCallback } from "grammy";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  ChatMemberCacheRepository,
  createDb,
  GroupRepository,
  GroupRosterRepository
} from "@splitbot/db";
import { signAvatarRequest, verifyAvatarRequest } from "./avatarSignature";
import { createChatMembersStorageAdapter } from "./chatMembersStorage";
import { env } from "./env";
import {
  ensureTelegramWebhook,
  fetchWebhookInfo,
  ROSTER_ALLOWED_UPDATES,
  webhookAllowsRosterUpdates,
  type WebhookInfoSummary
} from "./ensureTelegramWebhook";
import {
  backfillGroupAdminsAndCount,
  ingestMyChatMemberUpdate,
  ingestVisibleGroupUsers
} from "./groupRoster";
import { getSessionMembers, initMtcute, type TelegramGroupMember } from "./mtcuteClient";
import {
  directMiniAppLink,
  hasDirectMiniAppLinkConfig,
  webAppUrlWithStartParam
} from "./miniAppUrl";
import { buildOpenMiniAppReplyMarkup } from "./openMiniAppMarkup";
import { resolveGroupMembersChatId } from "./resolveGroupMembersChatId";
import {
  parseTelegramUserFromInitData,
  validateWebAppInitData
} from "./telegramWebAppAuth";
import {
  handleWidgetQuery,
  markDmStarted,
  sendBalanceWidget,
  type WidgetQueryUpdate
} from "./widgets/handlers";

type BotContext = Context & ChatMembersFlavor;

const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);
const db = createDb(env.SQLITE_PATH);
const groups = new GroupRepository(db);
const roster = new GroupRosterRepository(db);
const chatMemberCache = new ChatMemberCacheRepository(db, groups, roster);
const chatMembersAdapter = createChatMembersStorageAdapter(chatMemberCache);

console.log("[roster] SQLITE_PATH=", env.SQLITE_PATH);

// grammY chat-members plugin: persists join/leave/status to SQLite and mirrors
// into group_members. Requires chat_member in allowed_updates + bot admin.
bot.use(chatMembers(chatMembersAdapter));

// Persist every human sender the bot receives in groups (needs privacy OFF
// for ordinary messages). chat_member joins/leaves are handled by the plugin.
bot.use(async (ctx, next) => {
  try {
    ingestVisibleGroupUsers({ ctx, groups, roster });
    if (ctx.myChatMember) {
      ingestMyChatMemberUpdate({ ctx, groups });
    }
  } catch (err) {
    console.warn("[roster] ingest failed", err);
  }
  return next();
});

/** Prefer mtcute avatars but never drop SQLite-only message senders. */
function mergeMtcuteWithStoredRoster(
  mtcuteMembers: TelegramGroupMember[],
  stored: TelegramGroupMember[],
): TelegramGroupMember[] {
  const byId = new Map<number, TelegramGroupMember>();
  for (const m of stored) {
    byId.set(m.tgUserId, m);
  }
  for (const m of mtcuteMembers) {
    const prev = byId.get(m.tgUserId);
    if (!prev) {
      byId.set(m.tgUserId, m);
      continue;
    }
    byId.set(m.tgUserId, {
      ...prev,
      ...m,
      name: m.name || prev.name,
      avatarBgColors: m.avatarBgColors.length
        ? m.avatarBgColors
        : prev.avatarBgColors,
      hasPhoto: m.hasPhoto || prev.hasPhoto
    });
  }
  return [...byId.values()];
}


const AVATAR_SIG_TTL_SEC = 3600;

function toPublicMembers(
  members: TelegramGroupMember[],
  chatId: string,
): Omit<TelegramGroupMember, "hasPhoto">[] {
  const exp = Math.floor(Date.now() / 1000) + AVATAR_SIG_TTL_SEC;
  return members.map((m) => {
    const { hasPhoto, ...rest } = m;
    if (!hasPhoto) {
      return rest;
    }
    const sig = signAvatarRequest(m.tgUserId, chatId, exp, env.TELEGRAM_BOT_TOKEN);
    const qs = new URLSearchParams({
      chatId,
      exp: String(exp),
      sig
    });
    return {
      ...rest,
      avatarProxyPath: `/miniapp/avatar/${m.tgUserId}?${qs.toString()}`
    };
  });
}

const DEEP_LINK_SETUP_HINT =
  "Group deep links need TELEGRAM_BOT_USERNAME and TELEGRAM_MINI_APP_SHORT_NAME " +
  "on the bot host. Ask the admin to set them and restart the bot.";

bot.use(async (ctx, next) => {
  const raw = ctx.update as { widget_query?: WidgetQueryUpdate };
  if (raw.widget_query) {
    await handleWidgetQuery({
      db,
      botToken: env.TELEGRAM_BOT_TOKEN,
      query: raw.widget_query,
      botUsername: env.TELEGRAM_BOT_USERNAME,
      miniAppShortName: env.TELEGRAM_MINI_APP_SHORT_NAME
    });
    return;
  }
  return next();
});

bot.command("start", async (ctx) => {
  const chat = ctx.chat;
  const chatType = chat?.type ?? "private";
  const startPayload = { cid: String(chat?.id ?? ctx.from?.id ?? "") };
  const miniUrl = webAppUrlWithStartParam(startPayload);
  const direct = directMiniAppLink(startPayload);
  const replyMarkup = buildOpenMiniAppReplyMarkup({
    chatType,
    miniUrl,
    directUrl: direct
  });

  if (chat?.type === "private" && ctx.from) {
    markDmStarted(db, ctx.from);
    await ctx.reply(
      "Splitrr is ready. Use /split to open the Mini App, or /balance for your personal balance card.",
      replyMarkup ? { reply_markup: replyMarkup } : undefined
    );
    await sendBalanceWidget({
      db,
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: chat.id,
      telegramUserId: ctx.from.id,
      botUsername: env.TELEGRAM_BOT_USERNAME,
      miniAppShortName: env.TELEGRAM_MINI_APP_SHORT_NAME
    });
    return;
  }

  await ctx.reply(
    "Splitrr is ready. Use /split in a group (or here in DM) to open the Mini App, then scan a receipt or start an empty bill.",
    replyMarkup ? { reply_markup: replyMarkup } : undefined
  );
});

bot.command("balance", async (ctx) => {
  const chat = ctx.chat;
  if (!chat || chat.type !== "private" || !ctx.from) {
    await ctx.reply("Use /balance in a private chat with Splitrr.");
    return;
  }
  markDmStarted(db, ctx.from);
  await sendBalanceWidget({
    db,
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: chat.id,
    telegramUserId: ctx.from.id,
    botUsername: env.TELEGRAM_BOT_USERNAME,
    miniAppShortName: env.TELEGRAM_MINI_APP_SHORT_NAME
  });
});

bot.command("paydetails", async (ctx) => {
  const chat = ctx.chat;
  if (!chat || chat.type !== "private" || !ctx.from) {
    await ctx.reply("Use /paydetails in a private chat with Splitrr.");
    return;
  }
  markDmStarted(db, ctx.from);
  const text = (ctx.match ?? "").toString().trim();
  if (!text) {
    db.query(
      `UPDATE users SET payment_details = NULL WHERE telegram_user_id = ?1`,
    ).run(String(ctx.from.id));
    await ctx.reply(
      "Payment details cleared. Send /paydetails followed by your info (e.g. /paydetails Venmo @you) to store them for Splitrr cards.",
    );
    return;
  }
  const clipped = text.slice(0, 200);
  db.query(
    `INSERT INTO users (telegram_user_id, username, first_name, last_name, payment_details, dm_started_at)
     VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       payment_details = excluded.payment_details,
       username = COALESCE(excluded.username, users.username),
       first_name = COALESCE(excluded.first_name, users.first_name),
       last_name = COALESCE(excluded.last_name, users.last_name),
       dm_started_at = COALESCE(users.dm_started_at, datetime('now'))`,
  ).run(
    String(ctx.from.id),
    ctx.from.username ?? null,
    ctx.from.first_name ?? null,
    ctx.from.last_name ?? null,
    clipped,
  );
  await ctx.reply(
    `Saved payment details for Splitrr cards:\n${clipped}`,
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Commands:\n/split - open Splitrr Mini App\n/balance - your balance card (DM)\n/paydetails - store payment copy-text (DM)\n/history - latest bills\n/help - this message"
  );
});

bot.command("split", async (ctx) => {
  const chat = ctx.chat;
  if (!chat) {
    await ctx.reply("Could not resolve this chat.");
    return;
  }

  const startPayload = { cid: String(chat.id) };
  const miniUrl = webAppUrlWithStartParam(startPayload);
  const direct = directMiniAppLink(startPayload);

  // Group / supergroup: upsert group only — bills are created in the Mini App.
  if (chat.type === "group" || chat.type === "supergroup") {
    const groupId = groups.upsertGroup(
      String(chat.id),
      "title" in chat ? (chat.title ?? "Untitled group") : "Untitled group"
    );
    // Backfill admins + member_count into the stored roster (Bot API has no full list).
    await backfillGroupAdminsAndCount({
      api: ctx.api,
      chatId: chat.id,
      groupId,
      groups,
      roster,
      chatMemberCache
    });

    if (!hasDirectMiniAppLinkConfig() || !direct) {
      await ctx.reply(
        `Cannot open Splitrr in this group yet.\n${DEEP_LINK_SETUP_HINT}`
      );
      return;
    }

    await ctx.reply(
      "Open Splitrr to create or continue a bill for this chat.",
      {
        reply_markup: buildOpenMiniAppReplyMarkup({
          chatType: chat.type,
          miniUrl,
          directUrl: direct
        })
      }
    );
    return;
  }

  // Private / DM: web_app button (Telegram allows this only in private chats).
  if (chat.type === "private") {
    await ctx.reply("Open Splitrr to create or continue a bill.", {
      reply_markup: buildOpenMiniAppReplyMarkup({
        chatType: "private",
        miniUrl,
        directUrl: direct
      })
    });
    return;
  }

  await ctx.reply("Use /split in a group or in a private chat with the bot.");
});

bot.command("history", async (ctx) => {
  const chat = ctx.chat;
  if (!chat || !("title" in chat)) {
    await ctx.reply("Use /history inside a group chat.");
    return;
  }

  const row = db
    .query("SELECT id FROM groups WHERE telegram_chat_id = ?1")
    .get(String(chat.id)) as { id: number } | null;

  if (!row) {
    await ctx.reply("No bills yet. Use /split first.");
    return;
  }

  const bills = db
    .query(
      `SELECT id, title, status, bill_date, place, created_at
       FROM bill_sessions
       WHERE group_id = ?1
       ORDER BY created_at DESC
       LIMIT 10`
    )
    .all(row.id) as Array<{
    id: string;
    title: string;
    status: string;
    bill_date: string;
    place: string | null;
    created_at: string;
  }>;

  if (!bills.length) {
    await ctx.reply("No bills yet. Use /split first.");
    return;
  }

  const text = bills
    .map((b) => {
      const where = b.place ? ` · ${b.place}` : "";
      return `- ${b.title} (${b.status}) · ${b.bill_date}${where}`;
    })
    .join("\n");

  await ctx.reply(`Recent bills:\n${text}`);
});

// Intentionally no message:photo handler. Casual group photos must stay silent;
// receipts are scanned/uploaded only via the Mini App after /split (or DM).

const app = new Hono();

app.use(
  "/miniapp/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"]
  })
);

app.get("/miniapp/avatar/:userId", async (c) => {
  const userId = Number(c.req.param("userId"));
  if (!Number.isFinite(userId)) {
    return c.json({ error: "bad_request" }, 400);
  }
  const chatId = c.req.query("chatId");
  const expRaw = c.req.query("exp");
  const sig = c.req.query("sig");
  if (typeof chatId !== "string" || !chatId.trim() || !expRaw || !sig) {
    return c.json({ error: "bad_request" }, 400);
  }
  const expSec = Number(expRaw);
  if (!Number.isFinite(expSec)) {
    return c.json({ error: "bad_request" }, 400);
  }
  if (!verifyAvatarRequest(userId, chatId, expSec, sig, env.TELEGRAM_BOT_TOKEN)) {
    return c.json({ error: "forbidden" }, 403);
  }
  try {
    const photos = await bot.api.getUserProfilePhotos(userId, { limit: 1 });
    if (photos.total_count < 1 || !photos.photos[0]?.length) {
      return c.json({ error: "not_found" }, 404);
    }
    const sizes = photos.photos[0];
    const fileId = sizes[sizes.length - 1]!.file_id;
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) {
      return c.json({ error: "not_found" }, 404);
    }
    const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const upstream = await fetch(fileUrl);
    if (!upstream.ok) {
      return c.json({ error: "upstream" }, 502);
    }
    const buf = await upstream.arrayBuffer();
    const ct = upstream.headers.get("content-type") ?? "image/jpeg";
    return c.body(buf, 200, {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=3600"
    });
  } catch {
    return c.json({ error: "failed" }, 500);
  }
});

app.post("/miniapp/group-members", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  const initData = (body as { initData?: unknown }).initData;
  if (typeof initData !== "string" || !initData.trim()) {
    return c.json({ error: "missing_init_data" }, 400);
  }
  if (!validateWebAppInitData(initData, env.TELEGRAM_BOT_TOKEN)) {
    return c.json({ error: "invalid_init_data" }, 401);
  }

  const bodyChatId = (body as { telegramChatId?: unknown }).telegramChatId;
  const resolved = resolveGroupMembersChatId({
    initData,
    telegramChatId: typeof bodyChatId === "string" ? bodyChatId : null
  });
  if (!resolved.ok) {
    if (resolved.error === "chat_mismatch") {
      return c.json({ error: "chat_mismatch", members: [] }, 403);
    }
    return c.json({
      members: [],
      hint: "missing_chat_id",
      message:
        "Open Splitrr via /split in the group so the Mini App receives a group cid."
    });
  }

  const chatId = resolved.chatId;
  const groupId = groups.upsertGroup(chatId, "Group");
  const webAppUser = parseTelegramUserFromInitData(initData);
  if (webAppUser?.id != null) {
    roster.observeTelegramUser(groupId, webAppUser);
  }

  let mtcuteMembers: TelegramGroupMember[] = [];
  let mtcuteError: string | null = null;
  try {
    mtcuteMembers = await getSessionMembers(chatId);
    // Persist MTProto hits into the shared SQLite roster (same DB as the API).
    for (const m of mtcuteMembers) {
      roster.observeTelegramUser(groupId, {
        id: m.tgUserId,
        first_name: m.name
      });
    }
  } catch (err) {
    mtcuteError = err instanceof Error ? err.message : "mtcute_failed";
    console.warn("[roster] mtcute group-members failed", chatId, mtcuteError);
  }

  const stored: TelegramGroupMember[] = roster.listMembers(groupId).map((m) => ({
    tgUserId: m.tgUserId,
    name: m.name,
    avatarBgColors: [],
    hasPhoto: Boolean(m.photoUrl)
  }));
  // Merge so thin mtcute (non-admin) never hides SQLite message senders.
  const merged = mergeMtcuteWithStoredRoster(mtcuteMembers, stored);
  const source =
    mtcuteMembers.length > 0 && stored.length > 0
      ? "mtcute+roster"
      : mtcuteMembers.length > 0
        ? "mtcute"
        : "roster";
  const groupRow = groups.findByTelegramChatId(chatId);
  const botIsAdmin = groupRow?.bot_is_admin ?? null;
  return c.json({
    members: toPublicMembers(merged, chatId),
    source,
    mtcuteError,
    botIsAdmin,
    botUsername: env.TELEGRAM_BOT_USERNAME,
    hint:
      merged.length === 0
        ? "empty_roster"
        : "partial_roster"
  });
});

const handleTelegramWebhook = webhookCallback(bot, "hono");
app.post(`/webhook/${env.TELEGRAM_WEBHOOK_SECRET}`, async (c) => {
  // When setWebhook uses secret_token, Telegram sends this header. Accept either
  // matching header or missing header (path secret still required).
  const headerToken = c.req.header("x-telegram-bot-api-secret-token");
  if (headerToken != null && headerToken !== env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: "invalid_secret_token" }, 401);
  }
  return handleTelegramWebhook(c);
});

let lastWebhookInfo: WebhookInfoSummary | null = null;

app.get("/health", async (c) => {
  const info = lastWebhookInfo ?? (await fetchWebhookInfo(env.TELEGRAM_BOT_TOKEN));
  if (info) lastWebhookInfo = info;
  return c.json({
    ok: true,
    service: "bot",
    sqlitePath: env.SQLITE_PATH,
    webhook: {
      url: info?.url ?? null,
      allowedUpdates: info?.allowedUpdates ?? [],
      rosterUpdatesOk: webhookAllowsRosterUpdates(info),
      requiredAllowedUpdates: [...ROSTER_ALLOWED_UPDATES],
      pendingUpdateCount: info?.pendingUpdateCount ?? null,
      lastErrorMessage: info?.lastErrorMessage ?? null
    }
  });
});

await initMtcute();

const webhookEnsure = await ensureTelegramWebhook({
  botToken: env.TELEGRAM_BOT_TOKEN,
  webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
  webAppUrl: env.TELEGRAM_WEBAPP_URL
});
lastWebhookInfo = webhookEnsure.after;
if (!webhookEnsure.ok) {
  console.warn(
    "[webhook] roster allowed_updates not confirmed — message/chat_member may be missing",
    webhookEnsure.error ?? webhookEnsure.after,
  );
}

serve({ fetch: app.fetch, port: env.BOT_PORT });
console.log(`Bot webhook listening on ${env.BOT_PORT}`);
