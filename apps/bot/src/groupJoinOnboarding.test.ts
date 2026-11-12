import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createDb,
  GroupJoinCardRepository,
  GroupRepository,
  GroupRosterRepository,
} from "@splitbot/db";
import {
  appendJoinButtonToMarkup,
  formatJoinCardText,
  registerGroupJoiner,
  ROSTER_JOIN_CALLBACK,
  wasBotAddedAsMember,
} from "./groupJoinOnboarding";

describe("formatJoinCardText", () => {
  it("includes welcome, joined list, and admin tip when not admin", () => {
    const text = formatJoinCardText({
      members: [
        { tgUserId: 1, name: "Ada Lovelace", username: "ada", photoUrl: null },
        { tgUserId: 2, name: "Bob", username: null, photoUrl: null },
      ],
      botIsAdmin: false,
      botUsername: "SplitrrBot",
    });
    expect(text).toContain("Hi, I split bills here");
    expect(text).toContain("Joined (2): @ada, Bob");
    expect(text).toContain(
      "make @SplitrrBot an admin so new members are picked up automatically",
    );
  });

  it("omits admin tip when bot is admin", () => {
    const text = formatJoinCardText({
      members: [],
      botIsAdmin: true,
      botUsername: "SplitrrBot",
    });
    expect(text).toContain("nobody yet");
    expect(text).not.toContain("admin");
  });
});

describe("appendJoinButtonToMarkup", () => {
  it("adds a join callback row under the open button", () => {
    const markup = appendJoinButtonToMarkup({
      inline_keyboard: [[{ text: "Open Splitrr", url: "https://t.me/x" }]],
    });
    expect(markup.inline_keyboard).toEqual([
      [{ text: "Open Splitrr", url: "https://t.me/x" }],
      [{ text: "Join bill splitting", callback_data: ROSTER_JOIN_CALLBACK }],
    ]);
  });
});

describe("wasBotAddedAsMember", () => {
  it("detects left→member and ignores member→admin", () => {
    expect(
      wasBotAddedAsMember({
        old_chat_member: { status: "left" },
        new_chat_member: { status: "member" },
      }),
    ).toBe(true);
    expect(
      wasBotAddedAsMember({
        old_chat_member: { status: "member" },
        new_chat_member: { status: "administrator" },
      }),
    ).toBe(false);
  });
});

describe("registerGroupJoiner", () => {
  it("is idempotent and claims matching placeholders", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-join-reg-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);
    const joinCards = new GroupJoinCardRepository(db);
    void joinCards;

    const groupId = groups.upsertGroup("-55", "Crew");
    const hostId = roster.upsertUser({
      telegramUserId: "1",
      firstName: "Host",
    });
    const synId = roster.upsertUser({
      telegramUserId: "name:@zoe",
      firstName: "@zoe",
    });
    const billId = randomUUID();
    db.query(
      `INSERT INTO bill_sessions (id, group_id, title, status, created_by_user_id, bill_date, currency)
       VALUES (?1, ?2, 'Bill', 'pending', ?3, '2026-11-12', 'USD')`,
    ).run(billId, groupId, hostId);
    db.query(
      `INSERT INTO bill_session_members (id, bill_session_id, member_name, is_placeholder, placeholder_username)
       VALUES (?1, ?2, '@zoe', 1, 'zoe')`,
    ).run(randomUUID(), billId);
    const itemId = randomUUID();
    db.query(
      `INSERT INTO bill_items (id, bill_session_id, name, qty, unit_price_cents, total_price_cents, confidence)
       VALUES (?1, ?2, 'Soup', 1, 300, 300, 1)`,
    ).run(itemId, billId);
    db.query(
      `INSERT INTO item_assignments (id, bill_item_id, user_id, weight)
       VALUES (?1, ?2, ?3, 1)`,
    ).run(randomUUID(), itemId, synId);

    const first = registerGroupJoiner({
      db,
      groups,
      roster,
      telegramChatId: "-55",
      chatTitle: "Crew",
      user: { id: 9, first_name: "Zoe", username: "zoe", is_bot: false },
    });
    expect(first).not.toBeNull();
    expect(first!.alreadyJoined).toBe(false);
    expect(first!.claimedMemberNames).toEqual(["@zoe"]);
    expect(roster.listMembers(groupId).map((m) => m.tgUserId)).toContain(9);

    const second = registerGroupJoiner({
      db,
      groups,
      roster,
      telegramChatId: "-55",
      user: { id: 9, first_name: "Zoe", username: "zoe", is_bot: false },
    });
    expect(second!.alreadyJoined).toBe(true);
    expect(second!.claimedMemberNames).toEqual([]);
  });
});
