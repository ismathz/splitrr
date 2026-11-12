import type { Api, Context } from "grammy";
import type { Database } from "bun:sqlite";
import {
  claimPlaceholdersForJoiner,
  GroupJoinCardRepository,
  GroupRepository,
  GroupRosterRepository,
  type GroupRosterMember,
} from "@splitbot/db";

/** Inline callback_data for self-registration (≤64 bytes). */
export const ROSTER_JOIN_CALLBACK = "roster_join";

export const JOIN_CARD_INTRO =
  "Hi, I split bills here. Tap below so you can be added to bills.";

export const JOIN_BUTTON_TEXT = "Join Splitrr";

/** Telegram editMessageText practical throttle for a single join card. */
export const JOIN_CARD_EDIT_THROTTLE_MS = 2_000;

const JOINED_LIST_LIMIT = 8;

export function shortDisplayName(member: GroupRosterMember): string {
  if (member.username?.trim()) return `@${member.username.trim().replace(/^@/, "")}`;
  const first = member.name.trim().split(/\s+/)[0];
  return first || member.name;
}

export function formatJoinCardText(input: {
  members: GroupRosterMember[];
}): string {
  const lines = [JOIN_CARD_INTRO, ""];
  const members = input.members;
  if (members.length === 0) {
    lines.push("Joined: nobody yet — be the first.");
  } else {
    const shown = members.slice(0, JOINED_LIST_LIMIT).map(shortDisplayName);
    const extra = members.length - shown.length;
    const list =
      extra > 0
        ? `${shown.join(", ")} +${extra} more`
        : shown.join(", ");
    lines.push(`Joined (${members.length}): ${list}`);
  }

  return lines.join("\n");
}

export function buildJoinCallbackButton(
  text: string = JOIN_BUTTON_TEXT,
): { text: string; callback_data: string } {
  return { text, callback_data: ROSTER_JOIN_CALLBACK };
}

export function buildJoinCardReplyMarkup(): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [[buildJoinCallbackButton(JOIN_BUTTON_TEXT)]],
  };
}

/** Open Mini App row + Join row for /split prompts. */
export function appendJoinButtonToMarkup(
  markup:
    | {
        inline_keyboard: Array<
          Array<
            | { text: string; web_app: { url: string } }
            | { text: string; url: string }
            | { text: string; callback_data: string }
          >
        >;
      }
    | undefined,
  joinText: string = JOIN_BUTTON_TEXT,
): {
  inline_keyboard: Array<
    Array<
      | { text: string; web_app: { url: string } }
      | { text: string; url: string }
      | { text: string; callback_data: string }
    >
  >;
} {
  const rows = markup?.inline_keyboard ? [...markup.inline_keyboard] : [];
  rows.push([buildJoinCallbackButton(joinText)]);
  return { inline_keyboard: rows };
}

export type RegisterJoinerResult = {
  alreadyJoined: boolean;
  userId: number;
  claimedMemberNames: string[];
  billsTouched: string[];
};

function displayNameFromTelegramUser(user: {
  username?: string;
  first_name?: string;
  last_name?: string;
  id: number;
}): string {
  const first = user.first_name?.trim() ?? "";
  const last = user.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (user.username?.trim()) return user.username.trim();
  return String(user.id);
}

/**
 * Idempotent self-registration into the group roster + placeholder claim.
 */
export function registerGroupJoiner(input: {
  db: Database;
  groups: GroupRepository;
  roster: GroupRosterRepository;
  telegramChatId: string;
  chatTitle?: string;
  user: {
    id: number;
    is_bot?: boolean;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
}): RegisterJoinerResult | null {
  const { db, groups, roster, user } = input;
  if (!user?.id || user.is_bot) return null;

  const groupId = groups.upsertGroup(
    input.telegramChatId,
    input.chatTitle?.trim() || "Untitled group",
  );
  const alreadyJoined = roster.isMember(groupId, user.id);
  const userId = roster.observeTelegramUser(groupId, user);
  if (userId == null) return null;

  const claimed = claimPlaceholdersForJoiner(db, groupId, {
    userId,
    telegramUserId: String(user.id),
    username: user.username ?? null,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    displayName: displayNameFromTelegramUser(user),
  });

  return {
    alreadyJoined,
    userId,
    claimedMemberNames: claimed.claimedMemberNames,
    billsTouched: claimed.billsTouched,
  };
}

export function wasBotAddedAsMember(update: {
  old_chat_member?: { status?: string };
  new_chat_member?: { status?: string };
}): boolean {
  const prev = update.old_chat_member?.status;
  const next = update.new_chat_member?.status;
  const wasOut = !prev || prev === "left" || prev === "kicked";
  const isIn =
    next === "member" || next === "administrator" || next === "creator";
  return Boolean(wasOut && isIn);
}

type PendingJoinCardEdit = {
  timer: ReturnType<typeof setTimeout> | null;
  lastEditMs: number;
};

const pendingEdits = new Map<number, PendingJoinCardEdit>();

export function clearJoinCardEditThrottleForTests(): void {
  for (const entry of pendingEdits.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pendingEdits.clear();
}

/**
 * Edit the stored join card with the current roster. Throttled to respect
 * Telegram edit limits; coalesces rapid joins into one trailing edit.
 */
export async function refreshGroupJoinCard(input: {
  api: Api;
  roster: GroupRosterRepository;
  joinCards: GroupJoinCardRepository;
  groupId: number;
  force?: boolean;
}): Promise<"edited" | "scheduled" | "missing" | "failed"> {
  const card = input.joinCards.findByGroupId(input.groupId);
  if (!card) return "missing";

  const members = input.roster.listMembers(input.groupId);
  const text = formatJoinCardText({ members });
  const replyMarkup = buildJoinCardReplyMarkup();

  const runEdit = async (): Promise<"edited" | "failed"> => {
    try {
      await input.api.editMessageText(
        card.telegramChatId,
        card.messageId,
        text,
        { reply_markup: replyMarkup },
      );
      input.joinCards.markEdited(input.groupId);
      const entry = pendingEdits.get(input.groupId) ?? {
        timer: null,
        lastEditMs: 0,
      };
      entry.lastEditMs = Date.now();
      entry.timer = null;
      pendingEdits.set(input.groupId, entry);
      return "edited";
    } catch (err) {
      console.warn("[join-card] edit failed", input.groupId, err);
      return "failed";
    }
  };

  if (input.force) {
    return runEdit();
  }

  const now = Date.now();
  const entry = pendingEdits.get(input.groupId) ?? {
    timer: null,
    lastEditMs: card.lastEditAt ? Date.parse(card.lastEditAt) || 0 : 0,
  };
  const elapsed = now - entry.lastEditMs;
  if (elapsed >= JOIN_CARD_EDIT_THROTTLE_MS) {
    return runEdit();
  }

  if (entry.timer) {
    return "scheduled";
  }
  const wait = JOIN_CARD_EDIT_THROTTLE_MS - elapsed;
  entry.timer = setTimeout(() => {
    void refreshGroupJoinCard({ ...input, force: true });
  }, Math.max(wait, 50));
  pendingEdits.set(input.groupId, entry);
  return "scheduled";
}

export async function postGroupJoinCard(input: {
  api: Api;
  groups: GroupRepository;
  roster: GroupRosterRepository;
  joinCards: GroupJoinCardRepository;
  telegramChatId: string | number;
  chatTitle?: string;
}): Promise<{ groupId: number; messageId: number } | null> {
  const groupId = input.groups.upsertGroup(
    String(input.telegramChatId),
    input.chatTitle?.trim() || "Untitled group",
  );
  const members = input.roster.listMembers(groupId);
  const text = formatJoinCardText({ members });

  try {
    const msg = await input.api.sendMessage(input.telegramChatId, text, {
      reply_markup: buildJoinCardReplyMarkup(),
    });
    input.joinCards.upsert({
      groupId,
      telegramChatId: String(input.telegramChatId),
      messageId: msg.message_id,
    });
    return { groupId, messageId: msg.message_id };
  } catch (err) {
    console.warn("[join-card] send failed", input.telegramChatId, err);
    return null;
  }
}

/**
 * Handle my_chat_member for join-card lifecycle: post welcome card when added.
 */
export async function handleBotMembershipForJoinCard(input: {
  ctx: Context;
  groups: GroupRepository;
  roster: GroupRosterRepository;
  joinCards: GroupJoinCardRepository;
}): Promise<void> {
  const chat = input.ctx.chat;
  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;
  const update = input.ctx.myChatMember;
  if (!update) return;

  if (wasBotAddedAsMember(update)) {
    await postGroupJoinCard({
      api: input.ctx.api,
      groups: input.groups,
      roster: input.roster,
      joinCards: input.joinCards,
      telegramChatId: chat.id,
      chatTitle: "title" in chat ? chat.title : undefined,
    });
  }
}
