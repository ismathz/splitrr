import {
  parseTelegramChatIdFromInitData,
  type TelegramWebAppUser
} from "@splitbot/shared";

/**
 * When initData carries a chat/`cid`, it must match the requested telegram chat id.
 * Dev bypass (no initData) is allowed by the caller.
 */
export function authorizeRosterChatAccess(input: {
  initData: string | null;
  telegramChatId: string;
}): { ok: true } | { ok: false; error: string; status: 403 } {
  if (!input.initData) {
    return { ok: true };
  }
  const ctxChatId = parseTelegramChatIdFromInitData(input.initData);
  if (ctxChatId && ctxChatId !== input.telegramChatId) {
    return { ok: false, error: "chat_mismatch", status: 403 };
  }
  return { ok: true };
}

export function displayNameFromWebAppUser(user: TelegramWebAppUser): string {
  const first = user.first_name?.trim() ?? "";
  const last = user.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const username = user.username?.trim();
  if (username) return username;
  return String(user.id);
}
