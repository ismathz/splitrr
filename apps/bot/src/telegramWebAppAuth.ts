import { createHmac } from "node:crypto";

/**
 * Validates `Telegram.WebApp.initData` per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateWebAppInitData(
  initData: string,
  botToken: string
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

  const secretKey = createHmac("sha256", botToken)
    .update("WebAppData")
    .digest();
  const calculated = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return calculated === hash;
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
