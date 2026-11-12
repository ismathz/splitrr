import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import { applyMigrations } from "./migrations";
import {
  buildBotStartDeepLink,
  encodeAddedStartPayload,
  listPendingAddedForUser,
  listUndeliveredPendingForBill,
  markPendingAddedDelivered,
  parseAddedStartPayload,
  upsertPendingAddedNotification,
} from "./pendingAdded";

describe("pending added notifications", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    db.query(
      `INSERT INTO users (id, telegram_user_id, username, first_name)
       VALUES (1, '111', 'alice', 'Alice')`,
    ).run();
    db.query(
      `INSERT INTO groups (id, telegram_chat_id, title) VALUES (1, '-1001', 'G')`,
    ).run();
    db.query(
      `INSERT INTO bill_sessions (id, group_id, title, status, currency, created_by_user_id)
       VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 1, 'Dinner', 'pending', 'USD', 1)`,
    ).run();
  });

  it("round-trips uuid start payloads and deep links", () => {
    const payload = encodeAddedStartPayload(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(payload).toBe("naaaaaaaabbbbccccddddeeeeeeeeeeee");
    expect(parseAddedStartPayload(payload)).toEqual({
      billId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(buildBotStartDeepLink("SplitrrBot", payload)).toBe(
      "https://t.me/SplitrrBot?start=naaaaaaaabbbbccccddddeeeeeeeeeeee",
    );
  });

  it("lists undelivered rows for a bill and marks delivered", () => {
    upsertPendingAddedNotification(db, {
      billId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      memberName: "Bob",
      telegramUserId: "222",
      reason: "never_started",
    });
    const open = listUndeliveredPendingForBill(
      db,
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(open).toHaveLength(1);
    markPendingAddedDelivered(db, open[0]!.id);
    expect(
      listUndeliveredPendingForBill(
        db,
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    ).toHaveLength(0);
  });

  it("matches pending rows for a user by id, name, or bill hint", () => {
    upsertPendingAddedNotification(db, {
      billId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      memberName: "Cara",
      telegramUserId: null,
      reason: "placeholder",
    });
    const rows = listPendingAddedForUser(db, {
      telegramUserId: 999,
      firstName: "Cara",
      username: "cara",
      billIdHint: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.member_name).toBe("Cara");
  });
});
