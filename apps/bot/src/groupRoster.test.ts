import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, GroupRepository, GroupRosterRepository } from "@splitbot/db";
import { ingestChatMemberUpdate, ingestVisibleGroupUsers } from "./groupRoster";

describe("ingestVisibleGroupUsers", () => {
  it("records sender, newcomers, and removes leavers", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-bot-roster-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);

    const chat = { id: -10055, type: "supergroup" as const, title: "Crew" };

    ingestVisibleGroupUsers({
      ctx: {
        chat,
        from: { id: 1, first_name: "Host", is_bot: false },
        message: {
          new_chat_members: [
            { id: 2, first_name: "Join", is_bot: false },
            { id: 99, first_name: "Botling", is_bot: true }
          ]
        }
      } as any,
      groups,
      roster
    });

    const groupId = groups.findByTelegramChatId("-10055")!.id;
    expect(roster.listMembers(groupId).map((m) => m.tgUserId).sort()).toEqual([
      1, 2
    ]);

    ingestVisibleGroupUsers({
      ctx: {
        chat,
        from: { id: 1, first_name: "Host", is_bot: false },
        message: {
          left_chat_member: { id: 2, first_name: "Join", is_bot: false }
        }
      } as any,
      groups,
      roster
    });

    expect(roster.listMembers(groupId).map((m) => m.tgUserId)).toEqual([1]);
  });

  it("ignores private chats", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-bot-roster-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);

    ingestVisibleGroupUsers({
      ctx: {
        chat: { id: 42, type: "private" as const },
        from: { id: 42, first_name: "Solo", is_bot: false },
        message: {}
      } as any,
      groups,
      roster
    });

    expect(groups.findByTelegramChatId("42")).toBeNull();
  });
});

describe("ingestChatMemberUpdate", () => {
  it("adds members and removes leavers/kicked", () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-bot-roster-cm-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);
    const chat = { id: -10077, type: "supergroup" as const, title: "Crew" };

    ingestChatMemberUpdate({
      ctx: {
        chat,
        chatMember: {
          new_chat_member: {
            status: "member",
            user: { id: 9, first_name: "Nine", is_bot: false }
          }
        }
      } as any,
      groups,
      roster
    });

    const groupId = groups.findByTelegramChatId("-10077")!.id;
    expect(roster.listMembers(groupId).map((m) => m.tgUserId)).toEqual([9]);

    ingestChatMemberUpdate({
      ctx: {
        chat,
        chatMember: {
          new_chat_member: {
            status: "left",
            user: { id: 9, first_name: "Nine", is_bot: false }
          }
        }
      } as any,
      groups,
      roster
    });

    expect(roster.listMembers(groupId)).toEqual([]);
  });
});
