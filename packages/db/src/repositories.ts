import type { Database } from "bun:sqlite";

export interface CreateBillSessionInput {
  id: string;
  groupId: number;
  title: string;
  status: string;
  createdByUserId?: number;
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
    this.db
      .query(
        `INSERT INTO bill_sessions (id, group_id, title, status, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      )
      .run(
        input.id,
        input.groupId,
        input.title,
        input.status,
        input.createdByUserId ?? null
      );
  }

  updateStatus(sessionId: string, status: string): void {
    this.db
      .query(
        `UPDATE bill_sessions SET status = ?2, updated_at = datetime('now') WHERE id = ?1`
      )
      .run(sessionId, status);
  }
}
