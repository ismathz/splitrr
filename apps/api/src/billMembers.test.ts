import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { applyMigrations } from "@splitbot/db";

/**
 * Mirrors PATCH/GET bill member persistence (bill_session_members + assignees).
 */
function patchBill(
  db: Database,
  billId: string,
  body: {
    members?: string[];
    items?: Array<{
      id?: string;
      name: string;
      totalPriceCents: number;
      assignees?: string[];
    }>;
  }
) {
  const sessionMeta = db
    .query("SELECT group_id FROM bill_sessions WHERE id = ?1")
    .get(billId) as { group_id: number };
  const groupId = sessionMeta.group_id;

  const upsertUserByName = db.query(
    `INSERT INTO users (telegram_user_id, first_name)
     VALUES (?1, ?2)
     ON CONFLICT(telegram_user_id) DO UPDATE SET
       first_name = excluded.first_name`
  );
  const getUserByTelegramId = db.query(
    "SELECT id FROM users WHERE telegram_user_id = ?1"
  );
  const upsertGroupMember = db.query(
    `INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?1, ?2)`
  );
  const resolveNamedUserId = (displayName: string): number | null => {
    const syn = `name:${displayName.toLowerCase()}`;
    upsertUserByName.run(syn, displayName);
    const row = getUserByTelegramId.get(syn) as { id: number } | null;
    return row?.id ?? null;
  };

  if (Array.isArray(body.items)) {
    db.query("DELETE FROM bill_items WHERE bill_session_id = ?1").run(billId);
    const insertAssignment = db.query(
      `INSERT OR IGNORE INTO item_assignments (id, bill_item_id, user_id, weight)
       VALUES (?1, ?2, ?3, 1)`
    );
    for (const item of body.items) {
      const itemId = item.id ?? randomUUID();
      db.query(
        `INSERT INTO bill_items (id, bill_session_id, name, qty, unit_price_cents, total_price_cents, confidence)
         VALUES (?1, ?2, ?3, 1, ?4, ?4, 1)`
      ).run(itemId, billId, item.name, item.totalPriceCents);
      for (const raw of item.assignees ?? []) {
        const name = raw.trim();
        if (!name) continue;
        const userId = resolveNamedUserId(name);
        if (!userId) continue;
        upsertGroupMember.run(groupId, userId);
        insertAssignment.run(randomUUID(), itemId, userId);
      }
    }
  }

  if (Array.isArray(body.members)) {
    db.query("DELETE FROM bill_session_members WHERE bill_session_id = ?1").run(
      billId
    );
    const insertMember = db.query(
      `INSERT OR IGNORE INTO bill_session_members (id, bill_session_id, member_name)
       VALUES (?1, ?2, ?3)`
    );
    const seen = new Set<string>();
    for (const raw of body.members) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      insertMember.run(randomUUID(), billId, name);
      const userId = resolveNamedUserId(name);
      if (userId) upsertGroupMember.run(groupId, userId);
    }
  }
}

function loadMembers(db: Database, billId: string): string[] {
  const stored = db
    .query(
      `SELECT member_name FROM bill_session_members
       WHERE bill_session_id = ?1 ORDER BY created_at ASC`
    )
    .all(billId) as Array<{ member_name: string }>;
  return stored.map((r) => r.member_name);
}

function loadAssignees(db: Database, billId: string): string[][] {
  const items = db
    .query(
      `SELECT id FROM bill_items WHERE bill_session_id = ?1 ORDER BY created_at ASC`
    )
    .all(billId) as Array<{ id: string }>;
  return items.map((item) => {
    const rows = db
      .query(
        `SELECT COALESCE(NULLIF(trim(u.first_name), ''), u.telegram_user_id) AS display_name
         FROM item_assignments a
         JOIN users u ON u.id = a.user_id
         WHERE a.bill_item_id = ?1
         ORDER BY a.created_at ASC`
      )
      .all(item.id) as Array<{ display_name: string | null }>;
    return rows.map((r) => r.display_name?.trim() ?? "").filter(Boolean);
  });
}

describe("bill members persistence", () => {
  it("keeps members after save and reload even without item assignees", () => {
    const db = new Database(":memory:", { create: true, strict: true });
    applyMigrations(db);
    db.query(
      `INSERT INTO groups (telegram_chat_id, title) VALUES ('-1001', 'G')`
    ).run();
    const groupId = (
      db.query(`SELECT id FROM groups`).get() as { id: number }
    ).id;
    db.query(
      `INSERT INTO users (telegram_user_id, first_name) VALUES ('42', 'Host')`
    ).run();
    const hostId = (
      db
        .query(`SELECT id FROM users WHERE telegram_user_id = '42'`)
        .get() as { id: number }
    ).id;
    const billId = randomUUID();
    db.query(
      `INSERT INTO bill_sessions (id, group_id, title, status, created_by_user_id, bill_date, currency)
       VALUES (?1, ?2, 'Dinner', 'active', ?3, '2026-11-01', 'USD')`
    ).run(billId, groupId, hostId);

    patchBill(db, billId, {
      members: ["Alice", "Bob"],
      items: [
        {
          id: "item-1",
          name: "Pizza",
          totalPriceCents: 2000,
          assignees: [],
        },
      ],
    });

    expect(loadMembers(db, billId)).toEqual(["Alice", "Bob"]);
    expect(loadAssignees(db, billId)).toEqual([[]]);

    // Second save (edit again) must not wipe members.
    patchBill(db, billId, {
      members: ["Alice", "Bob", "Cara"],
      items: [
        {
          id: "item-1",
          name: "Pizza",
          totalPriceCents: 2000,
          assignees: ["Alice", "Bob"],
        },
      ],
    });

    expect(loadMembers(db, billId)).toEqual(["Alice", "Bob", "Cara"]);
    expect(loadAssignees(db, billId)).toEqual([["Alice", "Bob"]]);
  });
});
