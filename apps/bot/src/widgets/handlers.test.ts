import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { applyMigrations } from "@splitbot/db";
import {
  BALANCE_REFRESH_REQUEST,
  buildMarkPaidRequest,
  buildAddedChatData,
  buildBalanceChatData,
  serializeAddedChatData,
  serializeBalanceChatData,
} from "@splitbot/shared";
import { handleWidgetQuery, markDmStarted } from "./handlers";

function seedDb(): Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.query(
    `INSERT INTO users (id, telegram_user_id, username, first_name, dm_started_at, payment_details)
     VALUES (1, '111', 'alice', 'Alice', datetime('now'), 'Venmo @alice'),
            (2, '222', 'bob', 'Bob', datetime('now'), NULL)`,
  ).run();
  db.query(
    `INSERT INTO groups (id, telegram_chat_id, title) VALUES (1, '-1001', 'Friends')`,
  ).run();
  db.query(
    `INSERT INTO group_members (group_id, user_id) VALUES (1, 1), (1, 2)`,
  ).run();
  db.query(
    `INSERT INTO bill_sessions (id, group_id, title, status, currency, created_by_user_id)
     VALUES ('bill-1', 1, 'Dinner', 'pending', 'USD', 1)`,
  ).run();
  db.query(
    `INSERT INTO bill_session_members (id, bill_session_id, member_name)
     VALUES ('m1', 'bill-1', 'Alice'), ('m2', 'bill-1', 'Bob')`,
  ).run();
  db.query(
    `INSERT INTO bill_items (id, bill_session_id, name, qty, unit_price_cents, total_price_cents, confidence)
     VALUES ('i1', 'bill-1', 'Pizza', 1, 2000, 2000, 1)`,
  ).run();
  db.query(
    `INSERT INTO item_assignments (id, bill_item_id, user_id, weight)
     VALUES ('a1', 'i1', 2, 1)`,
  ).run();
  return db;
}

describe("widget data builders", () => {
  let db: Database;
  beforeEach(() => {
    db = seedDb();
  });

  it("builds balance lines for debtor and creditor", () => {
    const bob = buildBalanceChatData(db, 222, {
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
      revision: 1,
    });
    expect(bob.owe.length).toBeGreaterThan(0);
    expect(bob.owe[0]?.n).toBe("Alice");
    expect(serializeBalanceChatData(bob).length).toBeGreaterThan(2);

    const alice = buildBalanceChatData(db, 111, {
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
      revision: 1,
    });
    expect(alice.owed.some((l) => l.n === "Bob")).toBe(true);
  });

  it("builds added card with share + payment details", () => {
    const data = buildAddedChatData(db, {
      billId: "bill-1",
      memberName: "Bob",
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
      revision: 1,
    });
    expect(data).not.toBeNull();
    expect(data!.s).toBe(2000);
    expect(data!.pay).toContain("Venmo");
    expect(data!.items[0]?.n).toBe("Pizza");
    expect(serializeAddedChatData(data!).length).toBeGreaterThan(2);
  });
});

describe("widget_query handlers", () => {
  let db: Database;
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    db = seedDb();
    calls.length = 0;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      const method = url.split("/").pop() ?? "unknown";
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      calls.push({ method, body });
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  it("answers balance refresh and edits widget data", async () => {
    await handleWidgetQuery({
      db,
      botToken: "123:ABC",
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
      query: {
        id: "q1",
        from: { id: 222, first_name: "Bob" },
        chat: { id: 222, type: "private" },
        message_id: 9,
        data: BALANCE_REFRESH_REQUEST,
      },
    });
    expect(calls.some((c) => c.method === "answerWidgetQuery")).toBe(true);
    expect(calls.some((c) => c.method === "editMessageWidgetData")).toBe(true);
    const answer = calls.find((c) => c.method === "answerWidgetQuery");
    expect(String(answer?.body.widget_query_id)).toBe("q1");
    expect(String(answer?.body.data ?? "")).toContain("owe");
  });

  it("marks paid via p:<billId> and updates widget", async () => {
    await handleWidgetQuery({
      db,
      botToken: "123:ABC",
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
      query: {
        id: "q2",
        from: { id: 222, first_name: "Bob", username: "bob" },
        chat: { id: 222, type: "private" },
        message_id: 10,
        data: buildMarkPaidRequest("bill-1"),
      },
    });
    const paid = db
      .query(
        `SELECT paid FROM bill_member_payment_status
         WHERE bill_session_id = 'bill-1' AND member_name = 'Bob'`,
      )
      .get() as { paid: number };
    expect(paid.paid).toBe(1);
    expect(calls.some((c) => c.method === "answerWidgetQuery")).toBe(true);
    expect(calls.some((c) => c.method === "editMessageWidgetData")).toBe(true);
  });

  it("markDmStarted sets dm_started_at", () => {
    markDmStarted(db, { id: 333, first_name: "Cara" });
    const row = db
      .query(
        `SELECT dm_started_at FROM users WHERE telegram_user_id = '333'`,
      )
      .get() as { dm_started_at: string | null };
    expect(row.dm_started_at).toBeTruthy();
  });
});
