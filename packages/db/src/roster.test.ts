import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "./client";
import { GroupRepository, GroupRosterRepository } from "./repositories";

describe("GroupRosterRepository", () => {
  it("observes, lists, removes members and tracks member_count", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-roster-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);

    const groupId = groups.upsertGroup("-10042", "Test group");
    roster.observeTelegramUser(groupId, {
      id: 7,
      first_name: "Ada",
      last_name: "Lovelace",
      username: "ada",
      photo_url: "https://example.com/ada.jpg"
    });
    roster.observeTelegramUser(groupId, {
      id: 8,
      first_name: "Bob",
      is_bot: false
    });
    // Bots ignored
    expect(
      roster.observeTelegramUser(groupId, { id: 9, first_name: "Bot", is_bot: true })
    ).toBeNull();

    groups.setMemberCount(groupId, 12);

    const members = roster.listMembers(groupId);
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.tgUserId).sort()).toEqual([7, 8]);
    const ada = members.find((m) => m.tgUserId === 7)!;
    expect(ada.name).toBe("Ada Lovelace");
    expect(ada.username).toBe("ada");
    expect(ada.photoUrl).toBe("https://example.com/ada.jpg");

    roster.removeByTelegramUserId(groupId, "8");
    expect(roster.listMembers(groupId).map((m) => m.tgUserId)).toEqual([7]);

    const row = groups.findByTelegramChatId("-10042");
    expect(row?.member_count).toBe(12);

    // Updating without photoUrl must not wipe existing photo.
    roster.observeTelegramUser(groupId, {
      id: 7,
      first_name: "Ada",
      username: "ada2"
    });
    const ada2 = roster.listMembers(groupId).find((m) => m.tgUserId === 7)!;
    expect(ada2.username).toBe("ada2");
    expect(ada2.photoUrl).toBe("https://example.com/ada.jpg");
  });

  it("skips synthetic name: users in roster list", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-roster-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);
    const groupId = groups.upsertGroup("-1", "G");
    const userId = roster.upsertUser({
      telegramUserId: "name:alice",
      firstName: "Alice"
    });
    roster.addMember(groupId, userId);
    roster.observeTelegramUser(groupId, { id: 3, first_name: "Real" });
    expect(roster.listMembers(groupId).map((m) => m.name)).toEqual(["Real"]);
  });

  it("tracks bot_is_admin on groups", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-roster-admin-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const groupId = groups.upsertGroup("-1001", "G");
    expect(groups.findByTelegramChatId("-1001")?.bot_is_admin).toBeNull();
    groups.setBotIsAdmin(groupId, true);
    expect(groups.findByTelegramChatId("-1001")?.bot_is_admin).toBe(true);
    groups.setBotIsAdmin(groupId, false);
    expect(groups.findByTelegramChatId("-1001")?.bot_is_admin).toBe(false);
  });

  it("reports isMember for observed users", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-roster-ismember-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);
    const groupId = groups.upsertGroup("-9", "G");
    expect(roster.isMember(groupId, 3)).toBe(false);
    roster.observeTelegramUser(groupId, { id: 3, first_name: "Pat" });
    expect(roster.isMember(groupId, 3)).toBe(true);
    expect(roster.isMember(groupId, "3")).toBe(true);
  });
});
