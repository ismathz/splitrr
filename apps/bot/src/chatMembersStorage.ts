import type { StorageAdapter } from "grammy";
import type { ChatMember } from "grammy/types";
import {
  ChatMemberCacheRepository,
  type StoredChatMember,
} from "@splitbot/db";

/**
 * grammY StorageAdapter backed by SQLite (`chat_members_cache`) that also
 * mirrors joins/leaves into `group_members` for the Mini App roster.
 */
export function createChatMembersStorageAdapter(
  cache: ChatMemberCacheRepository,
): StorageAdapter<ChatMember> {
  return {
    read: async (key) => {
      const value = cache.read(key);
      return value as ChatMember | undefined;
    },
    write: async (key, value) => {
      cache.write(key, value as StoredChatMember);
    },
    delete: async (key) => {
      cache.delete(key);
    },
    has: async (key) => cache.has(key),
  };
}
