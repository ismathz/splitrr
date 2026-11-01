import type { GroupRepository, GroupRosterRepository } from "@splitbot/db";

type TelegramApiUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramApiResult<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

/**
 * Backfill stored roster from Bot API (admins + member_count).
 * Used by the API so Mini App open works even if the bot process wrote to a
 * different SQLite file or /split hasn't been re-run after deploy.
 */
export async function backfillRosterFromBotApi(input: {
  botToken: string;
  telegramChatId: string;
  groupId: number;
  groups: GroupRepository;
  roster: GroupRosterRepository;
}): Promise<{ adminsAdded: number; memberCount: number | null; error?: string }> {
  const { botToken, telegramChatId, groupId, groups, roster } = input;
  const base = `https://api.telegram.org/bot${botToken}`;
  let adminsAdded = 0;
  let memberCount: number | null = null;
  let error: string | undefined;

  try {
    const adminRes = await fetch(
      `${base}/getChatAdministrators?chat_id=${encodeURIComponent(telegramChatId)}`,
    );
    const adminJson = (await adminRes.json()) as TelegramApiResult<
      Array<{ user: TelegramApiUser }>
    >;
    if (!adminJson.ok || !Array.isArray(adminJson.result)) {
      error = adminJson.description || "getChatAdministrators_failed";
    } else {
      for (const row of adminJson.result) {
        const user = row?.user;
        if (!user?.id || user.is_bot) continue;
        roster.observeTelegramUser(groupId, user);
        adminsAdded += 1;
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

  return { adminsAdded, memberCount, error };
}
