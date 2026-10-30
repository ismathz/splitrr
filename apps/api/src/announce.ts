import {
  buildDirectMiniAppLink,
  parseTelegramChatIdFromInitData
} from "@splitbot/shared";

export type BillAnnounceRow = {
  billId: string;
  title: string;
  status: string;
  currency: string;
  billDate: string;
  place: string | null;
  telegramChatId: string;
};

export type AnnounceAuthInput = {
  authMode: "init_data" | "dev_bypass" | "cron";
  initData: string | null;
  telegramUserId: number | null;
};

/**
 * Authorize announce: require a Telegram user (or local bypass), and when
 * initData carries a chat/`cid`, it must match the bill’s group chat id.
 */
export function authorizeBillAnnounce(
  bill: BillAnnounceRow,
  auth: AnnounceAuthInput
): { ok: true } | { ok: false; status: 401 | 403; error: string } {
  if (auth.authMode === "dev_bypass") {
    return { ok: true };
  }

  if (auth.authMode !== "init_data" || auth.telegramUserId == null) {
    return { ok: false, status: 401, error: "missing_telegram_user" };
  }

  if (auth.initData) {
    const ctxChatId = parseTelegramChatIdFromInitData(auth.initData);
    if (ctxChatId && ctxChatId !== bill.telegramChatId) {
      return { ok: false, status: 403, error: "chat_mismatch" };
    }
  }

  return { ok: true };
}

export function formatBillAnnounceMessage(
  bill: BillAnnounceRow,
  extras?: {
    itemCount?: number;
    totalCents?: number;
    openUrl?: string | null;
  }
): string {
  const lines = [
    `Splitbot · ${bill.title}`,
    bill.place ? `Place: ${bill.place}` : null,
    `Date: ${bill.billDate}`,
    typeof extras?.itemCount === "number"
      ? `Items: ${extras.itemCount}`
      : null,
    typeof extras?.totalCents === "number"
      ? `Total: ${bill.currency} ${(extras.totalCents / 100).toFixed(2)}`
      : null,
    extras?.openUrl ? `Open: ${extras.openUrl}` : null
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

export function buildBillAnnounceOpenUrl(input: {
  botUsername: string;
  shortName: string;
  telegramChatId: string;
}): string | null {
  return buildDirectMiniAppLink({
    botUsername: input.botUsername,
    shortName: input.shortName,
    payload: { cid: input.telegramChatId }
  });
}
