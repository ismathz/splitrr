import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeTelegramBotToken } from "./telegramToken";
import {
  DEFAULT_INIT_DATA_MAX_AGE_SEC,
  parseInitDataPairs,
} from "./telegramWebAppInitData";

export {
  DEFAULT_INIT_DATA_MAX_AGE_SEC,
  WEBAPP_HMAC_ALGO,
  buildDirectMiniAppLink,
  encodeStartParamPayload,
  parseBillIdFromStartParam,
  parseChatIdFromStartParam,
  parseInitDataPairs,
  parseTelegramChatIdFromInitData,
  parseTelegramUserFromInitData,
  type StartParamPayload,
  type TelegramWebAppUser,
} from "./telegramWebAppInitData";

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
 *
 * Node-only (`node:crypto`). Mini App must import parsers from
 * `@splitbot/shared` / `telegramWebAppInitData`, not this module.
 */
export function validateWebAppInitDataDetailed(
  initData: string,
  botToken: string,
  options?: { maxAgeSec?: number; nowSec?: number },
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
  options?: { maxAgeSec?: number; nowSec?: number },
): boolean {
  return validateWebAppInitDataDetailed(initData, botToken, options).ok;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
