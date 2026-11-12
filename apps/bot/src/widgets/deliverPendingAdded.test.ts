import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import {
  applyMigrations,
  listUndeliveredPendingForBill,
  upsertPendingAddedNotification,
} from "@splitbot/db";
import { deliverPendingAddedCards } from "./deliverPendingAdded";

describe("deliverPendingAddedCards", () => {
  let db: Database;
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    db.query(
      `INSERT INTO users (id, telegram_user_id, username, first_name, dm_started_at)
       VALUES (1, '111', 'alice', 'Alice', datetime('now')),
              (2, '333', 'cara', 'Cara', NULL)`,
    ).run();
    db.query(
      `INSERT INTO groups (id, telegram_chat_id, title) VALUES (1, '-1001', 'Friends')`,
    ).run();
    db.query(
      `INSERT INTO group_members (group_id, user_id) VALUES (1, 1), (1, 2)`,
    ).run();
    db.query(
      `INSERT INTO bill_sessions (id, group_id, title, status, currency, created_by_user_id)
       VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 1, 'Dinner', 'pending', 'USD', 1)`,
    ).run();
    db.query(
      `INSERT INTO bill_session_members (id, bill_session_id, member_name)
       VALUES ('m1', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Cara')`,
    ).run();
    upsertPendingAddedNotification(db, {
      billId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      memberName: "Cara",
      telegramUserId: "333",
      reason: "never_started",
    });
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
      if (method === "sendWidget") {
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 99 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  it("sends pending added cards on /start and marks them delivered", async () => {
    const result = await deliverPendingAddedCards({
      db,
      botToken: "123:ABC",
      chatId: 333,
      from: { id: 333, username: "cara", first_name: "Cara" },
      startPayload: "naaaaaaaabbbbccccddddeeeeeeeeeeee",
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
    });
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(calls.some((c) => c.method === "sendWidget")).toBe(true);
    expect(
      listUndeliveredPendingForBill(
        db,
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    ).toHaveLength(0);
  });
});
