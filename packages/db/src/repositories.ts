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
