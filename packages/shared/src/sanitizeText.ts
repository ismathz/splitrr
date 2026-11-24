/**
 * Length caps for user-controlled free text stored or shown in Telegram/UI.
 * Keep short: titles/places appear in announce messages and widget payloads.
 */
export const TEXT_LIMITS = {
  billTitle: 80,
  place: 80,
  groupTitle: 128,
  itemName: 120,
  memberName: 64,
  chargeLabel: 120,
  paymentDetails: 200,
  merchantName: 80,
} as const;

/**
 * Control chars, bidi overrides, and zero-widths that break message layout
 * or spoof adjacent text even when HTML-escaped.
 */
const DANGEROUS_CHARS =
  // C0 controls + DEL + C1 controls
  /[\u0000-\u001F\u007F-\u009F]/g;
// Bidi / isolate overrides
const BIDI_CHARS = /[\u202A-\u202E\u2066-\u2069]/g;
// Zero-width + BOM + word joiner
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/**
 * Normalize free-text user input: drop control/bidi/zero-width characters,
 * collapse whitespace, trim, and enforce a max length.
 * Returns "" when the value is missing or empty after cleaning.
 */
export function sanitizeUserText(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 0;
  if (limit <= 0) return "";

  const cleaned = raw
    .replace(DANGEROUS_CHARS, " ")
    .replace(BIDI_CHARS, "")
    .replace(ZERO_WIDTH, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";
  return cleaned.length > limit ? cleaned.slice(0, limit).trimEnd() : cleaned;
}

/** Like {@link sanitizeUserText}, but empty results become `null`. */
export function sanitizeOptionalUserText(
  raw: unknown,
  maxLen: number,
): string | null {
  const cleaned = sanitizeUserText(raw, maxLen);
  return cleaned || null;
}
