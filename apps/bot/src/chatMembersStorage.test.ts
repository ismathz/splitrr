import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChatMemberCacheRepository,
  chatMemberStorageKey,
  createDb,
  GroupRepository,
  GroupRosterRepository,
} from "@splitbot/db";
import type { ChatMember } from "grammy/types";
import { createChatMembersStorageAdapter } from "./chatMembersStorage";

function member(
  partial: Partial<ChatMember> & {
    status: ChatMember["status"];
    user: { id: number; first_name?: string; is_bot?: boolean };
  },
): ChatMember {
  return partial as ChatMember;
}

describe("chatMembers StorageAdapter", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-cm-adapter-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);
    const cache = new ChatMemberCacheRepository(db, groups, roster);
    const adapter = createChatMembersStorageAdapter(cache);
    const chatId = "-100123";
    groups.upsertGroup(chatId, "Crew");
    return { groups, roster, cache, adapter, chatId };
  }

  it("join write adds to roster; leave delete removes", async () => {
    const { roster, adapter, chatId, groups } = setup();
    const groupId = groups.findByTelegramChatId(chatId)!.id;
    const key = chatMemberStorageKey(chatId, 42);

    await adapter.write(
      key,
      member({
        status: "member",
        user: { id: 42, first_name: "Joiner", is_bot: false },
      }),
    );

    expect(await adapter.read(key)).toMatchObject({
      status: "member",
      user: { id: 42 },
    });
    expect(roster.listMembers(groupId).map((m) => m.tgUserId)).toEqual([42]);

    await adapter.delete(key);
    expect(await adapter.read(key)).toBeUndefined();
    expect(roster.listMembers(groupId)).toEqual([]);
  });

  it("promote to administrator keeps roster entry and updates cache", async () => {
    const { roster, adapter, chatId, groups } = setup();
    const groupId = groups.findByTelegramChatId(chatId)!.id;
    const key = chatMemberStorageKey(chatId, 7);

    await adapter.write(
      key,
      member({
        status: "member",
        user: { id: 7, first_name: "Pat", is_bot: false },
      }),
    );
    await adapter.write(
      key,
      member({
        status: "administrator",
        user: { id: 7, first_name: "Pat", is_bot: false },
        can_be_edited: false,
        is_anonymous: false,
        can_manage_chat: true,
        can_delete_messages: false,
        can_manage_video_chats: false,
        can_restrict_members: false,
        can_promote_members: false,
        can_change_info: false,
        can_invite_users: true,
        can_post_stories: false,
        can_edit_stories: false,
        can_delete_stories: false,
      }),
    );

    expect(await adapter.read(key)).toMatchObject({ status: "administrator" });
    expect(roster.listMembers(groupId).map((m) => m.tgUserId)).toEqual([7]);
  });

  it("write left/kicked status removes from roster", async () => {
    const { roster, adapter, chatId, groups } = setup();
    const groupId = groups.findByTelegramChatId(chatId)!.id;
    const key = chatMemberStorageKey(chatId, 9);

    await adapter.write(
      key,
      member({
        status: "member",
        user: { id: 9, first_name: "Gone", is_bot: false },
      }),
    );
    await adapter.write(
      key,
      member({
        status: "kicked",
        user: { id: 9, first_name: "Gone", is_bot: false },
        until_date: 0,
      }),
    );

    expect(roster.listMembers(groupId)).toEqual([]);
    expect(await adapter.has?.(key)).toBe(true);
  });

  it("skips bots when syncing roster", async () => {
    const { roster, adapter, chatId, groups } = setup();
    const groupId = groups.findByTelegramChatId(chatId)!.id;
    const key = chatMemberStorageKey(chatId, 100);

    await adapter.write(
      key,
      member({
        status: "member",
        user: { id: 100, first_name: "OtherBot", is_bot: true },
      }),
    );

    expect(roster.listMembers(groupId)).toEqual([]);
    expect(await adapter.read(key)).toMatchObject({ user: { id: 100 } });
  });

  it("roster query lists after multiple joins", async () => {
    const { roster, adapter, chatId, groups } = setup();
    const groupId = groups.findByTelegramChatId(chatId)!.id;

    await adapter.write(
      chatMemberStorageKey(chatId, 1),
      member({
        status: "creator",
        user: { id: 1, first_name: "Owner", is_bot: false },
      }),
    );
    await adapter.write(
      chatMemberStorageKey(chatId, 2),
      member({
        status: "member",
        user: { id: 2, first_name: "A", is_bot: false },
      }),
    );
    await adapter.write(
      chatMemberStorageKey(chatId, 3),
      member({
        status: "member",
        user: { id: 3, first_name: "B", is_bot: false },
      }),
    );

    expect(roster.listMembers(groupId).map((m) => m.tgUserId).sort()).toEqual([
      1, 2, 3,
    ]);
  });
});
