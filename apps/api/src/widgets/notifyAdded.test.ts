import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { applyMigrations, listUndeliveredPendingForBill } from "@splitbot/db";
import { notifyNewlyAddedMembers } from "./notifyAdded";

describe("notifyNewlyAddedMembers", () => {
  let db: Database;
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    db.query(
      `INSERT INTO users (id, telegram_user_id, username, first_name, dm_started_at, payment_details)
       VALUES (1, '111', 'alice', 'Alice', datetime('now'), 'PayNow 123'),
              (2, '222', 'bob', 'Bob', datetime('now'), NULL),
              (3, '333', 'cara', 'Cara', NULL, NULL)`,
    ).run();
    db.query(
      `INSERT INTO groups (id, telegram_chat_id, title) VALUES (1, '-1001', 'Friends')`,
    ).run();
    db.query(
      `INSERT INTO group_members (group_id, user_id) VALUES (1, 1), (1, 2), (1, 3)`,
    ).run();
    db.query(
      `INSERT INTO bill_sessions (id, group_id, title, status, currency, created_by_user_id)
       VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 1, 'Dinner', 'pending', 'USD', 1)`,
    ).run();
    db.query(
      `INSERT INTO bill_session_members (id, bill_session_id, member_name, is_placeholder, placeholder_username)
       VALUES ('m1', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Alice', 0, NULL),
              ('m2', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Bob', 0, NULL),
              ('m3', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Cara', 0, NULL),
              ('m4', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '@dave', 1, 'dave')`,
    ).run();
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
          JSON.stringify({ ok: true, result: { message_id: 42 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  });

  it("DMs newly added members with a reachable private chat (incl. no prior dm_started)", async () => {
    const result = await notifyNewlyAddedMembers({
      db,
      botToken: "123:ABC",
      billId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      previousMembers: ["Alice"],
      nextMembers: ["Alice", "Bob", "Cara"],
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
    });
    // Bob already started; Cara has tg id but never started — still attempted.
    expect(result.sent).toBe(2);
    expect(result.undeliverable).toEqual([]);
    const widgetChats = calls
      .filter((c) => c.method === "sendWidget")
      .map((c) => c.body.chat_id)
      .sort();
    expect(widgetChats).toEqual([222, 333]);
    const cara = db
      .query(`SELECT dm_started_at FROM users WHERE telegram_user_id = '333'`)
      .get() as { dm_started_at: string | null };
    expect(cara.dm_started_at).toBeTruthy();
  });

  it("queues never_started when Telegram forbids initiating the chat", async () => {
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
      if (method === "sendWidget" || method === "sendMessage") {
        return new Response(
          JSON.stringify({
            ok: false,
            description: "Forbidden: bot can't initiate conversation with a user",
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await notifyNewlyAddedMembers({
      db,
      botToken: "123:ABC",
      billId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      previousMembers: [],
      nextMembers: ["Cara"],
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
    });
    expect(result.sent).toBe(0);
    expect(result.undeliverable).toHaveLength(1);
    expect(result.undeliverable[0]?.reason).toBe("never_started");
    expect(result.undeliverable[0]?.startLink).toContain(
      "https://t.me/SplitrrBot?start=n",
    );
    const pending = listUndeliveredPendingForBill(
      db,
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.reason).toBe("never_started");
    expect(pending[0]?.telegram_user_id).toBe("333");
  });

  it("queues placeholders without a Telegram id", async () => {
    const result = await notifyNewlyAddedMembers({
      db,
      botToken: "123:ABC",
      billId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      previousMembers: ["Alice"],
      nextMembers: ["Alice", "@dave"],
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
    });
    expect(result.sent).toBe(0);
    expect(result.undeliverable).toHaveLength(1);
    expect(result.undeliverable[0]?.reason).toBe("placeholder");
    expect(listUndeliveredPendingForBill(db, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toHaveLength(
      1,
    );
  });

  it("falls back to sendMessage when sendWidget fails", async () => {
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
          JSON.stringify({ ok: false, description: "widgets_unavailable" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 7 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await notifyNewlyAddedMembers({
      db,
      botToken: "123:ABC",
      billId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      previousMembers: [],
      nextMembers: ["Bob"],
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
    });
    expect(result.sent).toBe(1);
    const text = calls.find((c) => c.method === "sendMessage");
    expect(text).toBeTruthy();
    expect(String(text?.body.text ?? "")).toContain("Splitrr");
    expect(String(text?.body.text ?? "")).toContain("You've been added");
  });
});
