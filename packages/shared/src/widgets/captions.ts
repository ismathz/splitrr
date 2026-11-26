import { buildDirectMiniAppLink } from "../telegramWebAppInitData";
import type { AddedChatData, BalanceChatData } from "./types";

/** Same Mini App bill link used when a bill is shared to the group. */
export function buildAddedBillOpenUrl(
  data: Pick<AddedChatData, "bot" | "app" | "cid" | "bid">,
): string | null {
  if (!data.bot.trim() || !data.app.trim() || !data.cid.trim() || !data.bid.trim()) {
    return null;
  }
  return buildDirectMiniAppLink({
    botUsername: data.bot,
    shortName: data.app,
    payload: { cid: data.cid, bid: data.bid },
  });
}

/** Inline "Open bill" button for the added-to-bill DM. */
export function buildAddedOpenReplyMarkup(
  data: Pick<AddedChatData, "bot" | "app" | "cid" | "bid">,
):
  | { inline_keyboard: Array<Array<{ text: string; url: string }>> }
  | undefined {
  const openUrl = buildAddedBillOpenUrl(data);
  if (!openUrl) return undefined;
  return {
    inline_keyboard: [[{ text: "Open bill", url: openUrl }]],
  };
}

function money(currency: string, cents: number): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

/** Plain-text sendMessage fallback when sendWidget fails (not a widget caption). */
export function formatBalanceCaption(data: BalanceChatData): string {
  const oweLines =
    data.owe.length === 0
      ? ["You owe: nothing open"]
      : [
          "You owe:",
          ...data.owe.map(
            (l) => `· ${l.n}: ${money(l.c, l.a)}${l.l ? ` (${l.l})` : ""}`,
          ),
        ];
  const owedLines =
    data.owed.length === 0
      ? ["Owes you: nothing open"]
      : [
          "Owes you:",
          ...data.owed.map(
            (l) => `· ${l.n}: ${money(l.c, l.a)}${l.l ? ` (${l.l})` : ""}`,
          ),
        ];
  return ["Splitrr · Your balance", ...oweLines, ...owedLines].join("\n");
}

/** Plain-text sendMessage fallback when sendWidget fails (not a widget caption). */
export function formatAddedCaption(data: AddedChatData): string {
  const lines = [
    "Splitrr · You've been added",
    data.t,
    `Your share: ${money(data.c, data.s)}${data.paid ? " (paid)" : ""}`,
  ];
  if (data.items.length) {
    lines.push("Items:");
    for (const it of data.items.slice(0, 8)) {
      lines.push(`· ${it.n}: ${money(data.c, it.a)}`);
    }
  }
  if (data.pay) {
    lines.push(`Payment: ${data.pay}`);
  }
  const openUrl = buildAddedBillOpenUrl(data);
  if (openUrl) {
    lines.push(`Open: ${openUrl}`);
  }
  return lines.join("\n");
}
