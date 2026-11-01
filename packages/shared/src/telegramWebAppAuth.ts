import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeTelegramBotToken } from "./telegramToken";

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

export type InitDataValidationFailure =
  | "empty"
  | "missing_hash"
  | "bad_hash"
  | "bad_auth_date"
  | "expired"
  | "auth_date_in_future";

export type InitDataValidationResult =
  | { ok: true }
  | { ok: false; reason: InitDataValidationFailure };

/**
 * Validates `Telegram.WebApp.initData` per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateWebAppInitDataDetailed(
  initData: string,
  botToken: string,
  options?: { maxAgeSec?: number; nowSec?: number }
): InitDataValidationResult {
  if (!initData?.trim() || !botToken) return { ok: false, reason: "empty" };

  // Prefer raw pair split so we do not depend on URLSearchParams re-serialization quirks.
  const pairs = parseInitDataPairs(initData);
  if (!pairs) return { ok: false, reason: "empty" };

  const hash = pairs.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  // Bot-token HMAC `hash` is over ALL fields except `hash` itself — including
  // the Ed25519 `signature` field that modern clients always send.
  // (@telegram-apps/init-data-node / @tma.js/init-data-node do the same.)
  // Only third-party Ed25519 validation excludes both hash and signature.
  const checkPairs: [string, string][] = [];
  for (const [k, v] of pairs.entries()) {
    if (k === "hash") continue;
    checkPairs.push([k, v]);
  }
  // ASCII sort (avoid localeCompare quirks); matches URLSearchParams + .sort().
  checkPairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = checkPairs.map(([k, v]) => `${k}=${v}`).join("\n");

  // secret_key = HMAC-SHA256(bot_token) with key "WebAppData"
  const secretKey = createHmac("sha256", "WebAppData")
    .update(normalizeTelegramBotToken(botToken))
    .digest();
  const calculated = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!timingSafeEqualHex(calculated, hash)) {
    return { ok: false, reason: "bad_hash" };
  }

  const maxAgeSec = options?.maxAgeSec ?? DEFAULT_INIT_DATA_MAX_AGE_SEC;
  if (maxAgeSec > 0) {
    const authDateRaw = pairs.get("auth_date");
    const authDate = authDateRaw ? Number(authDateRaw) : NaN;
    if (!Number.isFinite(authDate)) {
      return { ok: false, reason: "bad_auth_date" };
    }
    const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
    if (nowSec - authDate > maxAgeSec) {
      return { ok: false, reason: "expired" };
    }
    if (authDate > nowSec + 60) {
      return { ok: false, reason: "auth_date_in_future" };
    }
  }

  return { ok: true };
}

export function validateWebAppInitData(
  initData: string,
  botToken: string,
  options?: { maxAgeSec?: number; nowSec?: number }
): boolean {
  return validateWebAppInitDataDetailed(initData, botToken, options).ok;
}

/**
 * Parse initData query string into decoded key/value pairs (Telegram signing form).
 * Returns null when the string is empty/unusable.
 */
export function parseInitDataPairs(
  initData: string
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

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function parseTelegramUserFromInitData(
  initData: string
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

/** Base64url JSON for `tgWebAppStartParam` / `start_param` / `startapp`. */
export function encodeStartParamPayload(payload: StartParamPayload): string {
  let json = JSON.stringify(payload);
  if (json.length > 1800) {
    // Prefer keeping bill deep-link target when truncating bulky member lists.
    json = JSON.stringify(
      payload.bid
        ? { cid: payload.cid, bid: payload.bid }
        : { cid: payload.cid }
    );
  }
  return Buffer.from(json, "utf8").toString("base64url");
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

  try {
    const pad =
      trimmed.length % 4 === 0 ? "" : "=".repeat(4 - (trimmed.length % 4));
    const decoded = Buffer.from(
      trimmed.replace(/-/g, "+").replace(/_/g, "/") + pad,
      "base64"
    ).toString("utf8");
    return tryJson(decoded);
  } catch {
    return null;
  }
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

export function parseTelegramChatIdFromInitData(initData: string): string | null {
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
