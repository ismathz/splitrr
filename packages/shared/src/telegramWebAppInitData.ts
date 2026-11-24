/**
 * Browser-safe Telegram WebApp initData / start_param parsers.
 * Keep Node `crypto` HMAC validation in `telegramWebAppAuth.ts` so the Mini App
 * Vite bundle never pulls `node:crypto`.
 */

/** Default max age for Telegram WebApp initData (24h). */
export const DEFAULT_INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

/**
 * Marker returned by /api/health so we can confirm the live verifier.
 * v2: data-check-string excludes only `hash` (must INCLUDE `signature` when present —
 * modern Telegram clients always send Ed25519 `signature` next to HMAC `hash`).
 */
export const WEBAPP_HMAC_ALGO = "WebAppData-as-key-v2-include-signature";

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  /** Present on Mini App initData `user` when Telegram includes it (cheap photo). */
  photo_url?: string;
}

/**
 * Parse initData query string into decoded key/value pairs (Telegram signing form).
 * Returns null when the string is empty/unusable.
 */
export function parseInitDataPairs(
  initData: string,
): Map<string, string> | null {
  const trimmed = initData.trim();
  if (!trimmed) return null;
  try {
    // URLSearchParams decodes values the same way Telegram's reference impl expects.
    const params = new URLSearchParams(trimmed);
    const out = new Map<string, string>();
    for (const [k, v] of params.entries()) {
      out.set(k, v);
    }
    return out.size ? out : null;
  } catch {
    return null;
  }
}

export function parseTelegramUserFromInitData(
  initData: string,
): TelegramWebAppUser | null {
  const pairs = parseInitDataPairs(initData);
  if (!pairs) return null;
  const userJson = pairs.get("user");
  if (!userJson) return null;
  try {
    const user = JSON.parse(userJson) as TelegramWebAppUser;
    if (typeof user.id !== "number") return null;
    return user;
  } catch {
    return null;
  }
}

export type StartParamPayload = {
  cid: string;
  /** Bill session id — Mini App should open `/bills/$bid` when present. */
  bid?: string;
  members?: string[];
};

/**
 * UTF-8 ↔ base64url without depending on Node `Buffer`.
 * Mini App bundles import these parsers; Vite does not polyfill Buffer.
 */
function utf8ToBase64Url(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64url");
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToUtf8(raw: string): string | null {
  try {
    const pad =
      raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + pad;
    if (typeof Buffer !== "undefined") {
      return Buffer.from(b64, "base64").toString("utf8");
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Base64url JSON for `tgWebAppStartParam` / `start_param` / `startapp`. */
export function encodeStartParamPayload(payload: StartParamPayload): string {
  let json = JSON.stringify(payload);
  if (json.length > 1800) {
    // Prefer keeping bill deep-link target when truncating bulky member lists.
    json = JSON.stringify(
      payload.bid
        ? { cid: payload.cid, bid: payload.bid }
        : { cid: payload.cid },
    );
  }
  return utf8ToBase64Url(json);
}

function parseStartParamObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tryJson = (s: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(s);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  };

  const direct = tryJson(trimmed);
  if (direct) return direct;

  const decoded = base64UrlToUtf8(trimmed);
  if (!decoded) return null;
  return tryJson(decoded);
}

/**
 * Direct Mini App link: `https://t.me/<bot>/<short_name>?startapp=<payload>`.
 * Returns null if username/short name missing or startapp exceeds Telegram’s 512 limit.
 */
export function buildDirectMiniAppLink(input: {
  botUsername: string | undefined | null;
  shortName: string | undefined | null;
  payload: StartParamPayload;
}): string | null {
  const user = input.botUsername?.trim().replace(/^@/, "");
  const app = input.shortName?.trim();
  if (!user || !app) return null;
  const startapp = encodeStartParamPayload(input.payload);
  if (startapp.length > 512) return null;
  return `https://t.me/${user}/${app}?startapp=${startapp}`;
}

export function parseTelegramChatIdFromInitData(
  initData: string,
): string | null {
  const pairs = parseInitDataPairs(initData);
  if (!pairs) return null;
  const chatJson = pairs.get("chat");
  if (chatJson) {
    try {
      const chat = JSON.parse(chatJson) as { id?: number };
      if (typeof chat.id === "number") return String(chat.id);
    } catch {
      /* ignore */
    }
  }
  const startParam = pairs.get("start_param");
  if (startParam) {
    const cid = parseChatIdFromStartParam(startParam);
    if (cid) return cid;
  }
  return null;
}

/** Decode `cid` from start_param / startapp (JSON or base64url JSON). */
export function parseChatIdFromStartParam(raw: string): string | null {
  const obj = parseStartParamObject(raw);
  if (!obj || !("cid" in obj)) return null;
  const v = obj.cid;
  if (v == null || !String(v).trim()) return null;
  return String(v).trim();
}

/** Decode bill id (`bid`) from start_param / startapp (JSON or base64url JSON). */
export function parseBillIdFromStartParam(raw: string): string | null {
  const obj = parseStartParamObject(raw);
  if (!obj || !("bid" in obj)) return null;
  const v = obj.bid;
  if (v == null || !String(v).trim()) return null;
  return String(v).trim();
}
