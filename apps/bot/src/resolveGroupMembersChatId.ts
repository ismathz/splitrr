import { parseTelegramChatIdFromInitData } from "@splitbot/shared";

/**
 * Resolve which Telegram chat to load members for.
 * Prefer signed initData chat/`cid`; accept client-supplied telegramChatId when
 * initData omits it (common for startapp opens where cid is only in the URL).
 */
export function resolveGroupMembersChatId(input: {
  initData: string;
  telegramChatId?: string | null;
}):
  | { ok: true; chatId: string }
  | { ok: false; error: "missing_chat_id" | "chat_mismatch" } {
  const fromInit = parseTelegramChatIdFromInitData(input.initData);
  const fromBody =
    typeof input.telegramChatId === "string" && input.telegramChatId.trim()
      ? input.telegramChatId.trim()
      : null;

  if (fromInit && fromBody && fromInit !== fromBody) {
    return { ok: false, error: "chat_mismatch" };
  }
  const chatId = fromInit ?? fromBody;
  if (!chatId) {
    return { ok: false, error: "missing_chat_id" };
  }
  return { ok: true, chatId };
}
