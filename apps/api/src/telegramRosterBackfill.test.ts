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
import { backfillRosterFromBotApi } from "./telegramRosterBackfill";

describe("backfillRosterFromBotApi", () => {
  it("upserts human admins, cache, member_count, and bot_is_admin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-api-backfill-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);
    const chatMemberCache = new ChatMemberCacheRepository(db, groups, roster);
    const groupId = groups.upsertGroup("-10077", "Crew");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("getMe")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { id: 12, is_bot: true, first_name: "Splitrr", username: "SplitrrBot" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("getChatAdministrators")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                status: "creator",
                user: { id: 11, first_name: "Owner", username: "owner" },
              },
              {
                status: "administrator",
                user: { id: 12, first_name: "Bot", is_bot: true },
              },
              {
                status: "administrator",
                user: { id: 13, first_name: "Mod" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("getChatMemberCount")) {
        return new Response(JSON.stringify({ ok: true, result: 9 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      const result = await backfillRosterFromBotApi({
        botToken: "1:FAKE",
        telegramChatId: "-10077",
        groupId,
        groups,
        roster,
        chatMemberCache,
      });
      expect(result.adminsAdded).toBe(2);
      expect(result.memberCount).toBe(9);
      expect(result.botIsAdmin).toBe(true);
      expect(result.error).toBeUndefined();
      expect(roster.listMembers(groupId).map((m) => m.tgUserId).sort()).toEqual([
        11, 13,
      ]);
      expect(groups.findByTelegramChatId("-10077")?.member_count).toBe(9);
      expect(groups.findByTelegramChatId("-10077")?.bot_is_admin).toBe(true);
      expect(
        chatMemberCache.read(chatMemberStorageKey("-10077", 11))?.status,
      ).toBe("creator");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sets bot_is_admin false when bot is not in admin list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "splitbot-api-backfill-noadmin-"));
    const db = createDb(join(dir, "test.db"));
    const groups = new GroupRepository(db);
    const roster = new GroupRosterRepository(db);
    const groupId = groups.upsertGroup("-10088", "Crew");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("getMe")) {
        return new Response(
          JSON.stringify({ ok: true, result: { id: 99, is_bot: true } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("getChatAdministrators")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                status: "creator",
                user: { id: 1, first_name: "Owner" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("getChatMemberCount")) {
        return new Response(JSON.stringify({ ok: true, result: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      const result = await backfillRosterFromBotApi({
        botToken: "1:FAKE",
        telegramChatId: "-10088",
        groupId,
        groups,
        roster,
      });
      expect(result.botIsAdmin).toBe(false);
      expect(groups.findByTelegramChatId("-10088")?.bot_is_admin).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
