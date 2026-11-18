import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations } from "@splitbot/db";

/**
 * Mirrors GET /api/groups/by-telegram-chat/:telegramChatId/history
 * (and /api/groups/:groupId/history) listing SQL in index.ts.
 */
function listGroupHistory(
  db: Database,
  groupId: number,
  createdByInternalId: number | null
) {
  return db
    .query(
      `SELECT id, title, created_by_user_id
       FROM bill_sessions
       WHERE group_id = ?1
         AND (?2 IS NULL OR created_by_user_id = ?2)
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .all(groupId, createdByInternalId) as Array<{
    id: string;
    title: string;
    created_by_user_id: number | null;
  }>;
}

describe("group bill history", () => {
  it("returns bills created by other members when no createdBy filter is given", () => {
    const db = new Database(":memory:", { create: true, strict: true });
    applyMigrations(db);

    db.query(
      `INSERT INTO groups (telegram_chat_id, title) VALUES ('-100999', 'Roommates')`
    ).run();
    const groupId = (
      db.query(`SELECT id FROM groups`).get() as { id: number }
    ).id;

    db.query(
      `INSERT INTO users (telegram_user_id, first_name) VALUES ('101', 'Ada')`
    ).run();
    db.query(
      `INSERT INTO users (telegram_user_id, first_name) VALUES ('202', 'Bob')`
    ).run();
    const adaId = (
      db
        .query(`SELECT id FROM users WHERE telegram_user_id = '101'`)
        .get() as { id: number }
    ).id;
    const bobId = (
      db
        .query(`SELECT id FROM users WHERE telegram_user_id = '202'`)
        .get() as { id: number }
    ).id;

    db.query(
      `INSERT INTO bill_sessions (id, group_id, title, status, created_by_user_id, bill_date, currency)
       VALUES ('bill-ada', ?1, 'Ada dinner', 'completed', ?2, '2026-11-01', 'USD')`
    ).run(groupId, adaId);
    db.query(
      `INSERT INTO bill_sessions (id, group_id, title, status, created_by_user_id, bill_date, currency)
       VALUES ('bill-bob', ?1, 'Bob brunch', 'active', ?2, '2026-11-02', 'USD')`
    ).run(groupId, bobId);

    // No filter (Mini App group history): every member sees every bill.
    const allBills = listGroupHistory(db, groupId, null);
    expect(allBills.map((b) => b.id).sort()).toEqual([
      "bill-ada",
      "bill-bob",
    ]);

    // Optional createdByUserId filter remains for compatibility.
    const onlyAda = listGroupHistory(db, groupId, adaId);
    expect(onlyAda.map((b) => b.id)).toEqual(["bill-ada"]);
  });
});
