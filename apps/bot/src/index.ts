import { Bot, webhookCallback } from "grammy";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { createDb, GroupRepository, BillSessionRepository } from "@splitbot/db";
import { signAvatarRequest, verifyAvatarRequest } from "./avatarSignature";
import { env } from "./env";
import { getSessionMembers, initMtcute, type TelegramGroupMember } from "./mtcuteClient";
import { directMiniAppLink, webAppUrlWithStartParam } from "./miniAppUrl";
import {
  parseTelegramChatIdFromInitData,
  validateWebAppInitData
} from "./telegramWebAppAuth";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
const db = createDb(env.SQLITE_PATH);
const groups = new GroupRepository(db);
const sessions = new BillSessionRepository(db);

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

function buildOpenMiniAppReplyMarkup(input: {
  chatType: "private" | "group" | "supergroup" | "channel";
  miniUrl: string;
  directUrl: string | null;
}) {
  // Telegram rejects InlineKeyboardButton.web_app in non-private chats.
  if (input.chatType === "private") {
    return {
      inline_keyboard: [[{ text: "Open Mini App", web_app: { url: input.miniUrl } }]]
    };
  }

  if (input.directUrl) {
    return {
      inline_keyboard: [[{ text: "Open Mini App", url: input.directUrl }]]
    };
  }

  return undefined;
}

bot.command("start", async (ctx) => {
  const chatType = ctx.chat?.type ?? "private";
  const baseMiniUrl = env.TELEGRAM_WEBAPP_URL;
  const direct = directMiniAppLink({ cid: String(ctx.chat?.id ?? ctx.from?.id ?? "") });
  const replyMarkup = buildOpenMiniAppReplyMarkup({
    chatType,
    miniUrl: baseMiniUrl,
    directUrl: direct
  });

  await ctx.reply(
    "Splitbot is ready. Use /newbill in a group, then upload a receipt photo or open the Mini App.",
    replyMarkup ? { reply_markup: replyMarkup } : undefined
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "Commands:\n/newbill - create bill session\n/history - latest bills\n/help - this message"
  );
});

bot.command("newbill", async (ctx) => {
  const chat = ctx.chat;
  if (!chat || !("title" in chat)) {
    await ctx.reply("Use /newbill inside a group chat.");
    return;
  }

  const groupId = groups.upsertGroup(String(chat.id), chat.title ?? "Untitled group");
  const billId = randomUUID();

  sessions.create({
    id: billId,
    groupId,
    title: `Bill ${new Date().toISOString().slice(0, 10)}`,
    status: "draft",
    createdByUserId: undefined,
    billDate: new Date().toISOString().slice(0, 10),
    place: null
  });

  const startPayload = { cid: String(chat.id) };
  const miniUrl = webAppUrlWithStartParam(startPayload);
  const direct = directMiniAppLink(startPayload);
  const lines = [
    `Bill created: ${billId}`,
    "Upload a receipt photo next.",
    direct ? `Open in Telegram: ${direct}` : ""
  ].filter(Boolean);

  await ctx.reply(lines.join("\n"), {
    reply_markup: buildOpenMiniAppReplyMarkup({
      chatType: chat.type,
      miniUrl,
      directUrl: direct
    })
  });
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
    await ctx.reply("No bills yet. Use /newbill first.");
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
    await ctx.reply("No bills yet. Use /newbill first.");
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
    await ctx.reply("Run /newbill first.");
    return;
  }

  const latest = db
    .query(
      `SELECT id FROM bill_sessions
       WHERE group_id = ?1
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(group.id) as { id: string } | null;

  if (!latest) {
    await ctx.reply("Run /newbill first.");
    return;
  }

  const startPayload = { cid: String(chat.id) };
  const miniUrl = webAppUrlWithStartParam(startPayload);
  const direct = directMiniAppLink(startPayload);

  await ctx.reply(
    `Got your photo for bill ${latest.id}. Open the Mini App to upload/scan the receipt (group photos are not auto-OCR’d yet).`,
    {
      reply_markup: buildOpenMiniAppReplyMarkup({
        chatType: chat.type,
        miniUrl,
        directUrl: direct
      })
    }
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
