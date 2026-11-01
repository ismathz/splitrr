/** Safe fingerprint of a Bot API token (`<botId>:<secret>`). Never log the secret. */
export function telegramTokenFingerprint(token: string | undefined | null): {
  configured: boolean;
  botId: string | null;
  tokenSuffix: string | null;
} {
  const raw = token?.trim().replace(/^["']|["']$/g, "") ?? "";
  if (!raw) {
    return { configured: false, botId: null, tokenSuffix: null };
  }
  const colon = raw.indexOf(":");
  if (colon <= 0) {
    return { configured: true, botId: null, tokenSuffix: raw.slice(-4) || null };
  }
  const botId = raw.slice(0, colon);
  const secret = raw.slice(colon + 1);
  return {
    configured: true,
    botId,
    tokenSuffix: secret ? secret.slice(-4) : null
  };
}

export function normalizeTelegramBotToken(token: string): string {
  return token.trim().replace(/^["']|["']$/g, "");
}

/** True when a string looks like Telegram WebApp initData (not start_param alone). */
export function looksLikeWebAppInitData(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return (
    (v.includes("hash=") || v.includes("hash%3D")) &&
    (v.includes("auth_date=") || v.includes("auth_date%3D"))
  );
}
