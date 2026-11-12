import type {
  ChatMemberCacheRepository,
  GroupRepository,
  GroupRosterRepository,
  StoredChatMember,
} from "@splitbot/db";

type TelegramApiUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChatMember = {
  status: string;
  user: TelegramApiUser;
  is_member?: boolean;
  [key: string]: unknown;
};

type TelegramApiResult<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

/**
 * Backfill stored roster from Bot API (admins + member_count + bot_is_admin).
 * Used by the API so Mini App open works even if the bot process wrote to a
 * different SQLite file or /split hasn't been re-run after deploy.
 */
export async function backfillRosterFromBotApi(input: {
  botToken: string;
  telegramChatId: string;
  groupId: number;
  groups: GroupRepository;
  roster: GroupRosterRepository;
  chatMemberCache?: ChatMemberCacheRepository;
}): Promise<{
  adminsAdded: number;
  memberCount: number | null;
  botIsAdmin: boolean | null;
  error?: string;
}> {
  const { botToken, telegramChatId, groupId, groups, roster, chatMemberCache } =
    input;
  const base = `https://api.telegram.org/bot${botToken}`;
  let adminsAdded = 0;
  let memberCount: number | null = null;
  let botIsAdmin: boolean | null = null;
  let error: string | undefined;

  let botId: number | null = null;
  try {
    const meRes = await fetch(`${base}/getMe`);
    const meJson = (await meRes.json()) as TelegramApiResult<{ id: number }>;
    if (meJson.ok && meJson.result?.id != null) {
      botId = meJson.result.id;
    }
  } catch {
    // Non-fatal — still try admins without bot_is_admin detection.
  }

  try {
    const adminRes = await fetch(
      `${base}/getChatAdministrators?chat_id=${encodeURIComponent(telegramChatId)}`,
    );
    const adminJson = (await adminRes.json()) as TelegramApiResult<
      TelegramChatMember[]
    >;
    if (!adminJson.ok || !Array.isArray(adminJson.result)) {
      error = adminJson.description || "getChatAdministrators_failed";
    } else {
      let seenBotAdmin = false;
      for (const row of adminJson.result) {
        const user = row?.user;
        if (!user?.id) continue;
        if (botId != null && user.id === botId) {
          seenBotAdmin =
            row.status === "administrator" || row.status === "creator";
        }
        if (user.is_bot) continue;
        roster.observeTelegramUser(groupId, user);
        chatMemberCache?.upsertMember(
          telegramChatId,
          row as StoredChatMember,
        );
        adminsAdded += 1;
      }
      if (botId != null) {
        botIsAdmin = seenBotAdmin;
        groups.setBotIsAdmin(groupId, seenBotAdmin);
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "getChatAdministrators_error";
  }

  try {
    const countRes = await fetch(
      `${base}/getChatMemberCount?chat_id=${encodeURIComponent(telegramChatId)}`,
    );
    const countJson = (await countRes.json()) as TelegramApiResult<number>;
    if (countJson.ok && typeof countJson.result === "number") {
      memberCount = countJson.result;
      groups.setMemberCount(groupId, memberCount);
    } else if (!error) {
      error = countJson.description || "getChatMemberCount_failed";
    }
  } catch (err) {
    if (!error) {
      error = err instanceof Error ? err.message : "getChatMemberCount_error";
    }
  }

  return { adminsAdded, memberCount, botIsAdmin, error };
}
