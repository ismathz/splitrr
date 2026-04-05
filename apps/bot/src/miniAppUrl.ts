import { env } from "./env";

export type StartParamPayload = { cid: string; members?: string[] };

/** Base64url JSON for `tgWebAppStartParam` / `start_param`. */
export function encodeStartParamPayload(payload: StartParamPayload): string {
  let json = JSON.stringify(payload);
  if (json.length > 1800) {
    json = JSON.stringify({ cid: payload.cid });
  }
  return Buffer.from(json, "utf8").toString("base64url");
}

/** Mini App URL with `tgWebAppStartParam` so the client gets `cid` (+ optional members). */
export function webAppUrlWithStartParam(payload: StartParamPayload): string {
  const u = new URL(env.TELEGRAM_WEBAPP_URL);
  u.searchParams.set("tgWebAppStartParam", encodeStartParamPayload(payload));
  return u.toString();
}

/** Optional direct link (only if BotFather short name + username are configured). */
export function directMiniAppLink(payload: StartParamPayload): string | null {
  const user = env.TELEGRAM_BOT_USERNAME;
  const app = env.TELEGRAM_MINI_APP_SHORT_NAME;
  if (!user || !app) return null;
  const startapp = encodeStartParamPayload(payload);
  if (startapp.length > 512) return null;
  return `https://t.me/${user}/${app}?startapp=${startapp}`;
}
