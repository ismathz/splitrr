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
  ): { id: number; title: string; member_count: number | null } | null {
    return (
      (this.db
        .query(
          `SELECT id, title, member_count
           FROM groups
           WHERE telegram_chat_id = ?1`,
        )
        .get(chatId) as
        | { id: number; title: string; member_count: number | null }
        | null) ?? null
    );
  }

  setMemberCount(groupId: number, memberCount: number): void {
    this.db
      .query(`UPDATE groups SET member_count = ?2 WHERE id = ?1`)
      .run(groupId, memberCount);
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
