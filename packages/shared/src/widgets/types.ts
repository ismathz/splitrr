/** Compact balance line in chat_data (≤1KB total payload). */
export type BalanceLineData = {
  /** Counterparty display name (truncated). */
  n: string;
  /** Amount in cents. */
  a: number;
  /** ISO currency. */
  c: string;
  /** Bill session id. */
  b: string;
  /** Group telegram chat id for Mini App deep link. */
  g: string;
  /** Optional short bill/group label. */
  l?: string;
};

/** Personal balance widget chat_data. */
export type BalanceChatData = {
  /** Revision for ignore-stale updates. */
  r: number;
  /** Lines the viewer owes. */
  owe: BalanceLineData[];
  /** Lines others owe the viewer. */
  owed: BalanceLineData[];
  /** Bot username without @. */
  bot: string;
  /** Mini App short name. */
  app: string;
};

/** Item row on the "you've been added" card. */
export type AddedItemData = {
  n: string;
  a: number;
};

/** Added-to-bill widget chat_data. */
export type AddedChatData = {
  r: number;
  /** Bill title (truncated). */
  t: string;
  /** Currency. */
  c: string;
  /** Viewer's share cents. */
  s: number;
  /** 1 when marked paid. */
  paid: 0 | 1;
  /** Compact assigned items. */
  items: AddedItemData[];
  /** Payer payment details for copyText (optional). */
  pay?: string;
  /** Bill id. */
  bid: string;
  /** Group telegram chat id. */
  cid: string;
  bot: string;
  app: string;
  /** Member name used for payment-status writes. */
  mn: string;
};

export const WIDGET_HTML_MAX_BYTES = 32768;
export const WIDGET_HTML_MAX_COMPRESSED_BYTES = 4096;
export const WIDGET_DATA_MAX_BYTES = 1024;
export const WIDGET_REQUEST_MAX_BYTES = 64;

/** Balance refresh request payload (1–64 bytes). */
export const BALANCE_REFRESH_REQUEST = "r";
/** Mark-as-paid request prefix; full payload is `p:<billId>` (≤64 bytes). */
export const ADDED_MARK_PAID_PREFIX = "p:";

export function buildMarkPaidRequest(billId: string): string {
  const payload = `${ADDED_MARK_PAID_PREFIX}${billId}`;
  if (Buffer.byteLength(payload, "utf8") > 64) {
    throw new Error("mark-paid request exceeds 64 bytes");
  }
  return payload;
}

export function parseMarkPaidRequest(data: string): string | null {
  const raw = data.trim();
  if (!raw.startsWith(ADDED_MARK_PAID_PREFIX)) return null;
  const billId = raw.slice(ADDED_MARK_PAID_PREFIX.length).trim();
  return billId || null;
}
