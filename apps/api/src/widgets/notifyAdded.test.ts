import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { applyMigrations } from "@splitbot/db";
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
       VALUES ('bill-1', 1, 'Dinner', 'pending', 'USD', 1)`,
    ).run();
    db.query(
      `INSERT INTO bill_session_members (id, bill_session_id, member_name)
       VALUES ('m1', 'bill-1', 'Alice'), ('m2', 'bill-1', 'Bob'), ('m3', 'bill-1', 'Cara')`,
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

  it("DMs only newly added members who started the bot", async () => {
    const result = await notifyNewlyAddedMembers({
      db,
      botToken: "123:ABC",
      billId: "bill-1",
      previousMembers: ["Alice"],
      nextMembers: ["Alice", "Bob", "Cara"],
      botUsername: "SplitrrBot",
      miniAppShortName: "app",
    });
    // Bob has dm_started; Cara does not.
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
    const widget = calls.find((c) => c.method === "sendWidget");
    expect(widget?.body.chat_id).toBe(222);
    expect(widget?.body).not.toHaveProperty("caption");
    expect(String(widget?.body.html ?? "")).toContain("Mark as paid");
    expect(calls.some((c) => c.method === "sendMessage")).toBe(false);
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
      billId: "bill-1",
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
