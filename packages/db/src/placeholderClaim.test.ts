import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDb } from "./client";
import { GroupRepository, GroupRosterRepository } from "./repositories";
import {
  claimPlaceholdersForJoiner,
  parsePlaceholderInput,
} from "./placeholderClaim";

describe("parsePlaceholderInput", () => {
  it("parses @username placeholders", () => {
    expect(parsePlaceholderInput("@Alice")).toEqual({
      memberName: "@Alice",
      placeholderUsername: "alice",
      isUsernamePlaceholder: true,
    });
  });

  it("keeps plain names as name-only placeholders", () => {
    expect(parsePlaceholderInput("Bob")).toEqual({
      memberName: "Bob",
      placeholderUsername: null,
      isUsernamePlaceholder: false,
    });
  });
});

describe("claimPlaceholdersForJoiner", () => {
  it("merges username placeholder shares onto the real user", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-claim-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);
    const groupId = groups.upsertGroup("-1001", "Crew");

    const hostId = roster.upsertUser({
      telegramUserId: "1",
      firstName: "Host",
    });
    roster.addMember(groupId, hostId);

    const synId = roster.upsertUser({
      telegramUserId: "name:@cara",
      firstName: "@cara",
      username: "cara",
    });
    roster.addMember(groupId, synId);

    const billId = randomUUID();
    db.query(
      `INSERT INTO bill_sessions (id, group_id, title, status, created_by_user_id, bill_date, currency)
       VALUES (?1, ?2, 'Dinner', 'pending', ?3, '2026-11-12', 'USD')`,
    ).run(billId, groupId, hostId);
    db.query(
      `INSERT INTO bill_session_members (id, bill_session_id, member_name, is_placeholder, placeholder_username)
       VALUES (?1, ?2, '@cara', 1, 'cara')`,
    ).run(randomUUID(), billId);
    const itemId = randomUUID();
    db.query(
      `INSERT INTO bill_items (id, bill_session_id, name, qty, unit_price_cents, total_price_cents, confidence)
       VALUES (?1, ?2, 'Pizza', 1, 1000, 1000, 1)`,
    ).run(itemId, billId);
    db.query(
      `INSERT INTO item_assignments (id, bill_item_id, user_id, weight)
       VALUES (?1, ?2, ?3, 1)`,
    ).run(randomUUID(), itemId, synId);

    const joinerId = roster.observeTelegramUser(groupId, {
      id: 42,
      first_name: "Cara",
      username: "cara",
    })!;

    const result = claimPlaceholdersForJoiner(db, groupId, {
      userId: joinerId,
      telegramUserId: "42",
      username: "cara",
      firstName: "Cara",
      displayName: "Cara",
    });

    expect(result.claimedMemberNames).toEqual(["@cara"]);
    expect(result.billsTouched).toEqual([billId]);

    const assignees = db
      .query(
        `SELECT u.telegram_user_id AS tid
         FROM item_assignments a
         JOIN users u ON u.id = a.user_id
         WHERE a.bill_item_id = ?1`,
      )
      .all(itemId) as Array<{ tid: string }>;
    expect(assignees.map((a) => a.tid)).toEqual(["42"]);

    const member = db
      .query(
        `SELECT member_name, is_placeholder, placeholder_username
         FROM bill_session_members WHERE bill_session_id = ?1`,
      )
      .get(billId) as {
      member_name: string;
      is_placeholder: number;
      placeholder_username: string | null;
    };
    expect(member.member_name).toBe("Cara");
    expect(member.is_placeholder).toBe(0);
    expect(member.placeholder_username).toBeNull();

    // Idempotent second claim does nothing.
    const again = claimPlaceholdersForJoiner(db, groupId, {
      userId: joinerId,
      telegramUserId: "42",
      username: "cara",
      firstName: "Cara",
      displayName: "Cara",
    });
    expect(again.claimedMemberNames).toEqual([]);
  });

  it("matches plain-name placeholders case-insensitively", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-claim-name-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);
    const groupId = groups.upsertGroup("-1002", "Crew");
    const hostId = roster.upsertUser({
      telegramUserId: "1",
      firstName: "Host",
    });
    const synId = roster.upsertUser({
      telegramUserId: "name:alice",
      firstName: "Alice",
    });
    const billId = randomUUID();
    db.query(
      `INSERT INTO bill_sessions (id, group_id, title, status, created_by_user_id, bill_date, currency)
       VALUES (?1, ?2, 'Lunch', 'draft', ?3, '2026-11-12', 'USD')`,
    ).run(billId, groupId, hostId);
    db.query(
      `INSERT INTO bill_session_members (id, bill_session_id, member_name, is_placeholder)
       VALUES (?1, ?2, 'Alice', 1)`,
    ).run(randomUUID(), billId);
    const itemId = randomUUID();
    db.query(
      `INSERT INTO bill_items (id, bill_session_id, name, qty, unit_price_cents, total_price_cents, confidence)
       VALUES (?1, ?2, 'Tea', 1, 500, 500, 1)`,
    ).run(itemId, billId);
    db.query(
      `INSERT INTO item_assignments (id, bill_item_id, user_id, weight)
       VALUES (?1, ?2, ?3, 1)`,
    ).run(randomUUID(), itemId, synId);

    const joinerId = roster.observeTelegramUser(groupId, {
      id: 7,
      first_name: "Alice",
      last_name: "Ng",
    })!;

    const result = claimPlaceholdersForJoiner(db, groupId, {
      userId: joinerId,
      telegramUserId: "7",
      firstName: "Alice",
      lastName: "Ng",
      displayName: "Alice Ng",
    });

    expect(result.claimedMemberNames).toEqual(["Alice"]);
    const tid = (
      db
        .query(
          `SELECT u.telegram_user_id AS tid
           FROM item_assignments a
           JOIN users u ON u.id = a.user_id
           WHERE a.bill_item_id = ?1`,
        )
        .get(itemId) as { tid: string }
    ).tid;
    expect(tid).toBe("7");
  });
});
