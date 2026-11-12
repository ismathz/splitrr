import type { Api, Context } from "grammy";
import type {
  ChatMemberCacheRepository,
  GroupRepository,
  GroupRosterRepository,
  StoredChatMember,
} from "@splitbot/db";


type TelegramUserLike = {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
};

function isGroupChat(
  chat: Context["chat"],
): chat is NonNullable<Context["chat"]> & {
  type: "group" | "supergroup";
  title?: string;
} {
  return Boolean(chat && (chat.type === "group" || chat.type === "supergroup"));
}

/**
 * Record every human Telegram user the bot can see in a group update.
 * Sources: any message/edited_message/command sender, new_chat_members,
 * left_chat_member. With BotFather privacy OFF, ordinary group messages
 * deliver every sender into SQLite via this path.
 */
export function ingestVisibleGroupUsers(input: {
  ctx: Context;
  groups: GroupRepository;
  roster: GroupRosterRepository;
}): void {
  const { ctx, groups, roster } = input;
  const chat = ctx.chat;
  if (!isGroupChat(chat)) return;

  const groupId = groups.upsertGroup(
    String(chat.id),
    "title" in chat ? (chat.title ?? "Untitled group") : "Untitled group",
  );

  const from = ctx.from;
  if (from && !from.is_bot) {
    roster.observeTelegramUser(groupId, from);
  }

  // message | edited_message | channel_post — join/leave service payloads.
  const msg =
    ctx.message ??
    ctx.editedMessage ??
    ctx.channelPost ??
    ctx.editedChannelPost;
  if (!msg || typeof msg !== "object") return;

  const newcomers = (msg as { new_chat_members?: TelegramUserLike[] })
    .new_chat_members;
  if (Array.isArray(newcomers)) {
    for (const user of newcomers) {
      roster.observeTelegramUser(groupId, user);
    }
  }

  const leaver = (msg as { left_chat_member?: TelegramUserLike }).left_chat_member;
  if (leaver && !leaver.is_bot) {
    roster.removeByTelegramUserId(groupId, String(leaver.id));
  }
}

/**
 * Record join/leave/status changes from `chat_member` updates.
 * Prefer the @grammyjs/chat-members plugin + SQLite adapter in production;
 * this remains for tests / fallback dual-write.
 */
export function ingestChatMemberUpdate(input: {
  ctx: Context;
  groups: GroupRepository;
  roster: GroupRosterRepository;
}): void {
  const { ctx, groups, roster } = input;
  const chat = ctx.chat;
  if (!isGroupChat(chat)) return;

  const update = ctx.chatMember;
  if (!update?.new_chat_member?.user) return;

  const groupId = groups.upsertGroup(
    String(chat.id),
    "title" in chat ? (chat.title ?? "Untitled group") : "Untitled group",
  );

  const user = update.new_chat_member.user;
  if (user.is_bot) return;

  const status = update.new_chat_member.status;
  if (status === "left" || status === "kicked") {
    roster.removeByTelegramUserId(groupId, String(user.id));
    return;
  }
  if (status === "restricted") {
    const restricted = update.new_chat_member as { is_member?: boolean };
    if (!restricted.is_member) {
      roster.removeByTelegramUserId(groupId, String(user.id));
      return;
    }
  }
  // member | administrator | creator | restricted (still in chat)
  if (
    status === "member" ||
    status === "administrator" ||
    status === "creator" ||
    status === "restricted"
  ) {
    roster.observeTelegramUser(groupId, user);
  }
}

/**
 * Track whether this bot is a group admin from `my_chat_member` updates.
 * Telegram only delivers `chat_member` (other users) when the bot is admin.
 */
export function ingestMyChatMemberUpdate(input: {
  ctx: Context;
  groups: GroupRepository;
}): void {
  const { ctx, groups } = input;
  const chat = ctx.chat;
  if (!isGroupChat(chat)) return;

  const update = ctx.myChatMember;
  if (!update?.new_chat_member) return;

  const groupId = groups.upsertGroup(
    String(chat.id),
    "title" in chat ? (chat.title ?? "Untitled group") : "Untitled group",
  );
  const status = update.new_chat_member.status;
  const isAdmin = status === "administrator" || status === "creator";
  groups.setBotIsAdmin(groupId, isAdmin);
}

/**
 * Backfill chat administrators into the stored roster / chat-members cache
 * and refresh member_count + bot_is_admin. Call on `/split` in groups —
 * Bot API cannot list all members.
 */
export async function backfillGroupAdminsAndCount(input: {
  api: Api;
  chatId: number | string;
  groupId: number;
  groups: GroupRepository;
  roster: GroupRosterRepository;
  chatMemberCache?: ChatMemberCacheRepository;
}): Promise<void> {
  const { api, chatId, groupId, groups, roster, chatMemberCache } = input;
  const telegramChatId = String(chatId);

  let botId: number | null = null;
  try {
    const me = await api.getMe();
    botId = me.id;
  } catch (err) {
    console.warn("[roster] getMe failed", chatId, err);
  }

  try {
    const admins = await api.getChatAdministrators(chatId);
    let botIsAdmin = false;
    for (const member of admins) {
      const user = member.user;
      if (!user) continue;
      if (botId != null && user.id === botId) {
        botIsAdmin =
          member.status === "administrator" || member.status === "creator";
      }
      if (user.is_bot) continue;
      roster.observeTelegramUser(groupId, user);
      chatMemberCache?.upsertMember(
        telegramChatId,
        member as unknown as StoredChatMember,
      );
    }
    if (botId != null) {
      groups.setBotIsAdmin(groupId, botIsAdmin);
    }
  } catch (err) {
    console.warn("[roster] getChatAdministrators failed", chatId, err);
  }

  try {
    const count = await api.getChatMemberCount(chatId);
    if (Number.isFinite(count) && count >= 0) {
      groups.setMemberCount(groupId, count);
    }
  } catch (err) {
    console.warn("[roster] getChatMemberCount failed", chatId, err);
  }
}