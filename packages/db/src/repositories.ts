import type { Database } from "bun:sqlite";

function resolveCurrencyCode(raw: string | undefined): string {
  if (raw === undefined || !raw.trim()) return "USD";
  const t = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(t) ? t : "USD";
}

export interface CreateBillSessionInput {
  id: string;
  groupId: number;
  title: string;
  status: string;
  createdByUserId?: number;
  /** ISO date YYYY-MM-DD; defaults to today if omitted. */
  billDate?: string;
  place?: string | null;
  /** ISO 4217 code; defaults to USD when omitted. */
  currency?: string;
}

export class GroupRepository {
  constructor(private readonly db: Database) {}

  upsertGroup(chatId: string, title: string): number {
    this.db
      .query(
        `INSERT INTO groups (telegram_chat_id, title)
         VALUES (?1, ?2)
         ON CONFLICT(telegram_chat_id) DO UPDATE SET title = excluded.title`
      )
      .run(chatId, title);

    const row = this.db
      .query("SELECT id FROM groups WHERE telegram_chat_id = ?1")
      .get(chatId) as { id: number };
    return row.id;
  }

  findByTelegramChatId(
    chatId: string,
  ): {
    id: number;
    title: string;
    member_count: number | null;
    bot_is_admin: boolean | null;
  } | null {
    const row = this.db
      .query(
        `SELECT id, title, member_count, bot_is_admin
         FROM groups
         WHERE telegram_chat_id = ?1`,
      )
      .get(chatId) as
      | {
          id: number;
          title: string;
          member_count: number | null;
          bot_is_admin: number | null;
        }
      | null;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      member_count: row.member_count,
      bot_is_admin:
        row.bot_is_admin === 1 ? true : row.bot_is_admin === 0 ? false : null,
    };
  }

  setMemberCount(groupId: number, memberCount: number): void {
    this.db
      .query(`UPDATE groups SET member_count = ?2 WHERE id = ?1`)
      .run(groupId, memberCount);
  }

  /** Persist whether @SplitrrBot is a group administrator (chat_member delivery). */
  setBotIsAdmin(groupId: number, botIsAdmin: boolean): void {
    this.db
      .query(`UPDATE groups SET bot_is_admin = ?2 WHERE id = ?1`)
      .run(groupId, botIsAdmin ? 1 : 0);
  }
}

export type UpsertTelegramUserInput = {
  telegramUserId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Only written when provided (including empty string → NULL). */
  photoUrl?: string | null;
};

export type GroupRosterMember = {
  tgUserId: number;
  name: string;
  username: string | null;
  photoUrl: string | null;
};

/**
 * Bot-visible Telegram group roster (admins, join/leave, message senders,
 * Mini App openers). Telegram Bot API has no full member list.
 */
export class GroupRosterRepository {
  constructor(private readonly db: Database) {}

  upsertUser(input: UpsertTelegramUserInput): number {
    const telegramUserId = String(input.telegramUserId).trim();
    if (!telegramUserId) {
      throw new Error("telegramUserId required");
    }

    const username =
      typeof input.username === "string" ? input.username.trim() || null : null;
    const firstName =
      typeof input.firstName === "string"
        ? input.firstName.trim() || null
        : null;
    const lastName =
      typeof input.lastName === "string" ? input.lastName.trim() || null : null;
    const hasPhoto = input.photoUrl !== undefined;
    const photoUrl =
      typeof input.photoUrl === "string" ? input.photoUrl.trim() || null : null;

    if (hasPhoto) {
      this.db
        .query(
          `INSERT INTO users (telegram_user_id, username, first_name, last_name, photo_url)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(telegram_user_id) DO UPDATE SET
             username = COALESCE(excluded.username, users.username),
             first_name = COALESCE(excluded.first_name, users.first_name),
             last_name = COALESCE(excluded.last_name, users.last_name),
             photo_url = excluded.photo_url`,
        )
        .run(telegramUserId, username, firstName, lastName, photoUrl);
    } else {
      this.db
        .query(
          `INSERT INTO users (telegram_user_id, username, first_name, last_name)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(telegram_user_id) DO UPDATE SET
             username = COALESCE(excluded.username, users.username),
             first_name = COALESCE(excluded.first_name, users.first_name),
             last_name = COALESCE(excluded.last_name, users.last_name)`,
        )
        .run(telegramUserId, username, firstName, lastName);
    }

    const row = this.db
      .query("SELECT id FROM users WHERE telegram_user_id = ?1")
      .get(telegramUserId) as { id: number };
    return row.id;
  }

  addMember(groupId: number, userId: number): void {
    this.db
      .query(
        `INSERT OR IGNORE INTO group_members (group_id, user_id)
         VALUES (?1, ?2)`,
      )
      .run(groupId, userId);
  }

  /**
   * Upsert user profile + ensure membership for a Telegram user visible in a group.
   */
  observeTelegramUser(
    groupId: number,
    user: {
      id: number;
      is_bot?: boolean;
      username?: string;
      first_name?: string;
      last_name?: string;
      photo_url?: string;
    },
    options?: { photoUrl?: string | null },
  ): number | null {
    if (!user?.id || user.is_bot) return null;
    const userId = this.upsertUser({
      telegramUserId: String(user.id),
      username: user.username ?? null,
      firstName: user.first_name ?? null,
      lastName: user.last_name ?? null,
      photoUrl:
        options && "photoUrl" in options
          ? options.photoUrl
          : user.photo_url !== undefined
            ? user.photo_url
            : undefined,
    });
    this.addMember(groupId, userId);
    return userId;
  }

  removeByTelegramUserId(groupId: number, telegramUserId: string): void {
    this.db
      .query(
        `DELETE FROM group_members
         WHERE group_id = ?1
           AND user_id IN (
             SELECT id FROM users WHERE telegram_user_id = ?2
           )`,
      )
      .run(groupId, String(telegramUserId));
  }

  listMembers(groupId: number): GroupRosterMember[] {
    const rows = this.db
      .query(
        `SELECT u.telegram_user_id AS telegram_user_id,
                u.username AS username,
                u.first_name AS first_name,
                u.last_name AS last_name,
                u.photo_url AS photo_url
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ?1
         ORDER BY
           LOWER(COALESCE(NULLIF(trim(u.first_name), ''), NULLIF(trim(u.username), ''), u.telegram_user_id)) ASC`,
      )
      .all(groupId) as Array<{
      telegram_user_id: string;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      photo_url: string | null;
    }>;

    const out: GroupRosterMember[] = [];
    for (const row of rows) {
      // Skip synthetic name:* assignees used by bill item assignment persistence.
      if (row.telegram_user_id.startsWith("name:")) continue;
      const tgUserId = Number(row.telegram_user_id);
      if (!Number.isFinite(tgUserId)) continue;
      const name = displayNameForUser(row);
      if (!name) continue;
      out.push({
        tgUserId,
        name,
        username: row.username?.trim() || null,
        photoUrl: row.photo_url?.trim() || null,
      });
    }
    return out;
  }

  /** True when a real (non-synthetic) Telegram user is already on the roster. */
  isMember(groupId: number, telegramUserId: string | number): boolean {
    const row = this.db
      .query(
        `SELECT 1 AS ok
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ?1
           AND u.telegram_user_id = ?2
         LIMIT 1`,
      )
      .get(groupId, String(telegramUserId)) as { ok: number } | null;
    return Boolean(row?.ok);
  }
}

export type GroupJoinCard = {
  groupId: number;
  telegramChatId: string;
  messageId: number;
  lastEditAt: string | null;
};

/** Persist the live-edited group join card message id for throttled edits. */
export class GroupJoinCardRepository {
  constructor(private readonly db: Database) {}

  upsert(input: {
    groupId: number;
    telegramChatId: string;
    messageId: number;
  }): void {
    this.db
      .query(
        `INSERT INTO group_join_cards (group_id, telegram_chat_id, message_id, last_edit_at, created_at)
         VALUES (?1, ?2, ?3, NULL, datetime('now'))
         ON CONFLICT(group_id) DO UPDATE SET
           telegram_chat_id = excluded.telegram_chat_id,
           message_id = excluded.message_id`,
      )
      .run(input.groupId, input.telegramChatId, input.messageId);
  }

  findByGroupId(groupId: number): GroupJoinCard | null {
    const row = this.db
      .query(
        `SELECT group_id, telegram_chat_id, message_id, last_edit_at
         FROM group_join_cards
         WHERE group_id = ?1`,
      )
      .get(groupId) as
      | {
          group_id: number;
          telegram_chat_id: string;
          message_id: number;
          last_edit_at: string | null;
        }
      | null;
    if (!row) return null;
    return {
      groupId: row.group_id,
      telegramChatId: row.telegram_chat_id,
      messageId: row.message_id,
      lastEditAt: row.last_edit_at,
    };
  }

  markEdited(groupId: number, atIso: string = new Date().toISOString()): void {
    this.db
      .query(
        `UPDATE group_join_cards
         SET last_edit_at = ?2
         WHERE group_id = ?1`,
      )
      .run(groupId, atIso);
  }

  delete(groupId: number): void {
    this.db
      .query(`DELETE FROM group_join_cards WHERE group_id = ?1`)
      .run(groupId);
  }
}

/** Telegram ChatMember-shaped JSON stored by @grammyjs/chat-members. */
export type StoredChatMember = {
  status: string;
  user: {
    id: number;
    is_bot?: boolean;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  is_member?: boolean;
  [key: string]: unknown;
};

export function chatMemberStorageKey(
  chatId: string | number,
  userId: number | string,
): string {
  return `${chatId}_${userId}`;
}

export function parseChatMemberStorageKey(
  key: string,
): { chatId: string; userId: string } | null {
  const idx = key.lastIndexOf("_");
  if (idx <= 0 || idx === key.length - 1) return null;
  return { chatId: key.slice(0, idx), userId: key.slice(idx + 1) };
}

/** True when the ChatMember is currently in the chat (not left/kicked/restricted-out). */
export function chatMemberIsPresent(member: StoredChatMember): boolean {
  if (member.status === "left" || member.status === "kicked") return false;
  if (member.status === "restricted") return member.is_member === true;
  return (
    member.status === "member" ||
    member.status === "administrator" ||
    member.status === "creator"
  );
}

/**
 * Persistent storage for @grammyjs/chat-members, mirrored into group_members.
 */
export class ChatMemberCacheRepository {
  constructor(
    private readonly db: Database,
    private readonly groups: GroupRepository,
    private readonly roster: GroupRosterRepository,
  ) {}

  read(key: string): StoredChatMember | undefined {
    const row = this.db
      .query(
        `SELECT member_json AS member_json
         FROM chat_members_cache
         WHERE cache_key = ?1`,
      )
      .get(key) as { member_json: string } | null;
    if (!row?.member_json) return undefined;
    try {
      return JSON.parse(row.member_json) as StoredChatMember;
    } catch {
      return undefined;
    }
  }

  write(key: string, member: StoredChatMember): void {
    const parsed = parseChatMemberStorageKey(key);
    const chatId = parsed?.chatId ?? "";
    const userId = parsed?.userId ?? String(member.user?.id ?? "");
    const status = member.status ?? "member";

    this.db
      .query(
        `INSERT INTO chat_members_cache (
           cache_key, telegram_chat_id, telegram_user_id, status, member_json, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
         ON CONFLICT(cache_key) DO UPDATE SET
           telegram_chat_id = excluded.telegram_chat_id,
           telegram_user_id = excluded.telegram_user_id,
           status = excluded.status,
           member_json = excluded.member_json,
           updated_at = datetime('now')`,
      )
      .run(key, chatId, userId, status, JSON.stringify(member));

    this.syncRoster(chatId, member);
  }

  delete(key: string): void {
    const existing = this.read(key);
    const parsed = parseChatMemberStorageKey(key);
    this.db
      .query(`DELETE FROM chat_members_cache WHERE cache_key = ?1`)
      .run(key);

    const chatId = parsed?.chatId;
    const userId =
      parsed?.userId ??
      (existing?.user?.id != null ? String(existing.user.id) : null);
    if (!chatId || !userId) return;

    const group = this.groups.findByTelegramChatId(chatId);
    if (!group) return;
    this.roster.removeByTelegramUserId(group.id, userId);
  }

  has(key: string): boolean {
    const row = this.db
      .query(`SELECT 1 AS ok FROM chat_members_cache WHERE cache_key = ?1`)
      .get(key) as { ok: number } | null;
    return Boolean(row?.ok);
  }

  /** Seed / refresh a ChatMember into cache + roster (admin backfill). */
  upsertMember(
    telegramChatId: string,
    member: StoredChatMember,
  ): void {
    if (!member?.user?.id) return;
    const key = chatMemberStorageKey(telegramChatId, member.user.id);
    this.write(key, member);
  }

  private syncRoster(telegramChatId: string, member: StoredChatMember): void {
    if (!telegramChatId || !member?.user?.id) return;
    if (member.user.is_bot) return;

    const groupId = this.groups.upsertGroup(telegramChatId, "Group");
    if (chatMemberIsPresent(member)) {
      this.roster.observeTelegramUser(groupId, member.user);
    } else {
      this.roster.removeByTelegramUserId(groupId, String(member.user.id));
    }
  }
}

function displayNameForUser(row: {
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  telegram_user_id: string;
}): string {
  const first = row.first_name?.trim() ?? "";
  const last = row.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const username = row.username?.trim();
  if (username) return username;
  return row.telegram_user_id;
}

export class BillSessionRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateBillSessionInput): void {
    const billDate =
      input.billDate ?? new Date().toISOString().slice(0, 10);
    const currency = resolveCurrencyCode(input.currency);
    this.db
      .query(
        `INSERT INTO bill_sessions (id, group_id, title, status, created_by_user_id, bill_date, place, currency)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      )
      .run(
        input.id,
        input.groupId,
        input.title,
        input.status,
        input.createdByUserId ?? null,
        billDate,
        input.place ?? null,
        currency
      );
  }

  updateCurrency(sessionId: string, currency: string): void {
    const code = resolveCurrencyCode(currency);
    this.db
      .query(
        `UPDATE bill_sessions SET currency = ?2, updated_at = datetime('now') WHERE id = ?1`
      )
      .run(sessionId, code);
  }

  updateStatus(sessionId: string, status: string): void {
    this.db
      .query(
        `UPDATE bill_sessions SET status = ?2, updated_at = datetime('now') WHERE id = ?1`
      )
      .run(sessionId, status);
  }
}
