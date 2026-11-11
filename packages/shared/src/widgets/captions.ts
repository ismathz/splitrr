import type { AddedChatData, BalanceChatData } from "./types";

function money(currency: string, cents: number): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

/** Plain-text caption / non-widget fallback for the balance card. */
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

/** Plain-text caption / non-widget fallback for the added-to-bill card. */
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
  return lines.join("\n");
}
