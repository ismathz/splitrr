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

export type AnnouncePerson = {
  /** Display / bill member name. */
  displayName: string;
  /** Telegram @username without leading @ when known. */
  username?: string | null;
  /** Numeric Telegram user id when known (for tg:// mentions). */
  telegramUserId?: number | null;
  /** True when the person was added before self-registering via Join. */
  isPlaceholder?: boolean;
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

/** Format ISO YYYY-MM-DD for announce copy (stable en-US, calendar day). */
export function formatAnnounceBillDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return isoDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Prefer @username; else tg:// user mention (HTML); else plain escaped name.
 */
export function formatAnnouncePersonMention(person: AnnouncePerson): string {
  const username = person.username?.trim().replace(/^@/, "") ?? "";
  if (username) {
    return `@${username}`;
  }
  const name = person.displayName.trim() || "someone";
  if (
    person.telegramUserId != null &&
    Number.isFinite(person.telegramUserId) &&
    person.telegramUserId > 0
  ) {
    return `<a href="tg://user?id=${person.telegramUserId}">${escapeHtml(name)}</a>`;
  }
  return escapeHtml(name);
}

/** Label used in “Waiting on … to join” for placeholders. */
export function formatWaitingOnLabel(person: AnnouncePerson): string {
  const username = person.username?.trim().replace(/^@/, "") ?? "";
  if (username) return `@${username}`;
  const name = person.displayName.trim();
  if (name.startsWith("@")) return name;
  return name || "someone";
}

export type AnnounceStartNudge = {
  /** People who need to /start the bot for the added card + future DMs. */
  labels: string[];
  /** Deep link `t.me/<bot>?start=...` for this bill. */
  startLink: string;
};

export function formatAnnounceStartNudge(nudge: AnnounceStartNudge): string {
  const labels = nudge.labels
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (labels.length === 0 || !nudge.startLink.trim()) return "";
  const who = labels.map((l) => escapeHtml(l)).join(", ");
  return `DM alerts: ${who} — Start Splitrr here for this bill + notifications: ${nudge.startLink.trim()}`;
}

export function formatBillAnnounceMessage(
  bill: BillAnnounceRow,
  extras?: {
    itemCount?: number;
    totalCents?: number;
    openUrl?: string | null;
    people?: AnnouncePerson[];
    /** Recipients who did not get a private "you've been added" card yet. */
    startNudge?: AnnounceStartNudge | null;
  }
): string {
  const people = (extras?.people ?? []).filter((p) => p.displayName.trim());
  const joined = people.filter((p) => !p.isPlaceholder);
  const waiting = people.filter((p) => p.isPlaceholder);
  const peopleLine =
    joined.length > 0
      ? `With: ${joined.map(formatAnnouncePersonMention).join(", ")}`
      : null;
  const waitingLine =
    waiting.length > 0
      ? `Waiting on ${waiting.map(formatWaitingOnLabel).join(", ")} to join`
      : null;
  const startNudgeLine = extras?.startNudge
    ? formatAnnounceStartNudge(extras.startNudge)
    : "";

  const lines = [
    `Splitrr · ${escapeHtml(bill.title)}`,
    bill.place ? `Place: ${escapeHtml(bill.place)}` : null,
    `Date: ${formatAnnounceBillDate(bill.billDate)}`,
    peopleLine,
    waitingLine,
    startNudgeLine || null,
    typeof extras?.itemCount === "number"
      ? `Items: ${extras.itemCount}`
      : null,
    typeof extras?.totalCents === "number"
      ? `Total: ${escapeHtml(bill.currency)} ${(extras.totalCents / 100).toFixed(2)}`
      : null,
    extras?.openUrl ? `Open: ${extras.openUrl}` : null
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

/** Inline keyboard for shared bill messages: Join & claim + optional Open. */
export function buildBillAnnounceReplyMarkup(input: {
  openUrl?: string | null;
  joinCallbackData?: string;
  joinButtonText?: string;
}):
  | {
      inline_keyboard: Array<
        Array<
          | { text: string; callback_data: string }
          | { text: string; url: string }
        >
      >;
    }
  | undefined {
  const rows: Array<
    Array<
      | { text: string; callback_data: string }
      | { text: string; url: string }
    >
  > = [];
  const joinData = input.joinCallbackData ?? "roster_join";
  rows.push([
    {
      text: input.joinButtonText ?? "Join & claim my items",
      callback_data: joinData
    }
  ]);
  if (input.openUrl) {
    rows.push([{ text: "Open bill", url: input.openUrl }]);
  }
  return { inline_keyboard: rows };
}

export function buildBillAnnounceOpenUrl(input: {
  botUsername: string;
  shortName: string;
  telegramChatId: string;
  /** When set, Mini App opens this bill's details instead of home. */
  billId?: string;
}): string | null {
  return buildDirectMiniAppLink({
    botUsername: input.botUsername,
    shortName: input.shortName,
    payload: {
      cid: input.telegramChatId,
      ...(input.billId ? { bid: input.billId } : {})
    }
  });
}
