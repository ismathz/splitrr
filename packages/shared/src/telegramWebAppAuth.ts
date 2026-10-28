import { createHmac, timingSafeEqual } from "node:crypto";

/** Default max age for Telegram WebApp initData (24h). */
export const DEFAULT_INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/**
 * Validates `Telegram.WebApp.initData` per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateWebAppInitData(
  initData: string,
  botToken: string,
  options?: { maxAgeSec?: number; nowSec?: number }
): boolean {
  if (!initData?.trim() || !botToken) return false;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return false;
  }
  const hash = params.get("hash");
  if (!hash) return false;

  const pairs: [string, string][] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash" || k === "signature") continue;
    pairs.push([k, v]);
  }
  pairs.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  // secret_key = HMAC_SHA256(bot_token, "WebAppData")
  const secretKey = createHmac("sha256", botToken)
    .update("WebAppData")
    .digest();
  const calculated = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!timingSafeEqualHex(calculated, hash)) return false;

  const maxAgeSec = options?.maxAgeSec ?? DEFAULT_INIT_DATA_MAX_AGE_SEC;
  if (maxAgeSec > 0) {
    const authDateRaw = params.get("auth_date");
    const authDate = authDateRaw ? Number(authDateRaw) : NaN;
    if (!Number.isFinite(authDate)) return false;
    const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
    if (nowSec - authDate > maxAgeSec) return false;
    if (authDate > nowSec + 60) return false;
  }

  return true;
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
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const userJson = params.get("user");
  if (!userJson) return null;
  try {
    const user = JSON.parse(userJson) as TelegramWebAppUser;
    if (typeof user.id !== "number") return null;
    return user;
  } catch {
    return null;
  }
}

export function parseTelegramChatIdFromInitData(initData: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const chatJson = params.get("chat");
  if (chatJson) {
    try {
      const chat = JSON.parse(chatJson) as { id?: number };
      if (typeof chat.id === "number") return String(chat.id);
    } catch {
      /* ignore */
    }
  }
  const startParam = params.get("start_param");
  if (startParam) {
    const cid = parseChatIdFromStartParam(startParam);
    if (cid) return cid;
  }
  return null;
}

function parseChatIdFromStartParam(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const tryJson = (s: string): string | null => {
    try {
      const parsed: unknown = JSON.parse(s);
      if (parsed && typeof parsed === "object" && "cid" in parsed) {
        const v = (parsed as { cid?: unknown }).cid;
        if (v != null && String(v).trim()) return String(v);
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
