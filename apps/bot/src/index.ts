import { Bot, webhookCallback } from "grammy";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createDb, GroupRepository, GroupRosterRepository } from "@splitbot/db";
import { signAvatarRequest, verifyAvatarRequest } from "./avatarSignature";
import { env } from "./env";
import {
  backfillGroupAdminsAndCount,
  ingestVisibleGroupUsers
} from "./groupRoster";
import { getSessionMembers, initMtcute, type TelegramGroupMember } from "./mtcuteClient";
import {
  directMiniAppLink,
  hasDirectMiniAppLinkConfig,
  webAppUrlWithStartParam
} from "./miniAppUrl";
import { buildOpenMiniAppReplyMarkup } from "./openMiniAppMarkup";
import {
  parseTelegramChatIdFromInitData,
  validateWebAppInitData
} from "./telegramWebAppAuth";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
const db = createDb(env.SQLITE_PATH);
const groups = new GroupRepository(db);
const roster = new GroupRosterRepository(db);

// Persist every human the bot can see in groups (privacy mode limits this).
bot.use(async (ctx, next) => {
  try {
    ingestVisibleGroupUsers({ ctx, groups, roster });
  } catch (err) {
    console.warn("[roster] ingest failed", err);
  }
  return next();
});


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
  "(BotFather Mini App short name) on the bot host. Ask the admin to set them and restart the bot.";

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

  await ctx.reply(
    "Splitrr is ready. Use /split in a group (or here in DM) to open the Mini App, then scan a receipt or start an empty bill.",
    replyMarkup ? { reply_markup: replyMarkup } : undefined
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Commands:\n/split - open Splitrr Mini App\n/history - latest bills\n/help - this message"
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
      roster
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

bot.on("message:photo", async (ctx) => {
  const chat = ctx.chat;
  if (!chat || !("title" in chat)) {
    await ctx.reply("Please upload receipt photo in group chat.");
    return;
  }

  const group = db
    .query("SELECT id FROM groups WHERE telegram_chat_id = ?1")
    .get(String(chat.id)) as { id: number } | null;

  if (!group) {
    await ctx.reply("Use /split to open Splitrr, then scan or upload the receipt there.");
    return;
  }

  const latest = db
    .query(
      `SELECT id FROM bill_sessions
       WHERE group_id = ?1
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(group.id) as { id: string } | null;

  const startPayload = { cid: String(chat.id) };
  const miniUrl = webAppUrlWithStartParam(startPayload);
  const direct = directMiniAppLink(startPayload);
  const replyMarkup = buildOpenMiniAppReplyMarkup({
    chatType: chat.type,
    miniUrl,
    directUrl: direct
  });

  if (!latest) {
    const setupMissing = (chat.type === "group" || chat.type === "supergroup") && !direct;
    await ctx.reply(
      setupMissing
        ? `Got your photo. Open Splitrr with /split to scan it (group photos are not auto-OCR’d yet).\n${DEEP_LINK_SETUP_HINT}`
        : "Got your photo. Open Splitrr to scan or upload the receipt (group photos are not auto-OCR’d yet).",
      replyMarkup ? { reply_markup: replyMarkup } : undefined
    );
    return;
  }

  if ((chat.type === "group" || chat.type === "supergroup") && !direct) {
    await ctx.reply(
      `Got your photo for bill ${latest.id}. Open Splitrr with /split to upload/scan the receipt (group photos are not auto-OCR’d yet).\n${DEEP_LINK_SETUP_HINT}`
    );
    return;
  }

  await ctx.reply(
    `Got your photo for bill ${latest.id}. Open Splitrr to upload/scan the receipt (group photos are not auto-OCR’d yet).`,
    replyMarkup ? { reply_markup: replyMarkup } : undefined
  );
});

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
  const chatId = parseTelegramChatIdFromInitData(initData);
  if (!chatId) {
    return c.json({ members: [] });
  }
  try {
    const members = await getSessionMembers(chatId);
    return c.json({ members: toPublicMembers(members, chatId) });
  } catch {
    return c.json({ members: [] });
  }
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
app.get("/health", (c) => c.json({ ok: true }));

await initMtcute();

serve({ fetch: app.fetch, port: env.BOT_PORT });
console.log(`Bot webhook listening on ${env.BOT_PORT}`);
