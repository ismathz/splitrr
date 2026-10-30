import {
  buildDirectMiniAppLink,
  encodeStartParamPayload,
  type StartParamPayload
} from "@splitbot/shared";
import { env } from "./env";

export type { StartParamPayload };
export { encodeStartParamPayload };

/** Mini App URL with `tgWebAppStartParam` so the client gets `cid` (+ optional members). */
export function webAppUrlWithStartParam(payload: StartParamPayload): string {
  const u = new URL(env.TELEGRAM_WEBAPP_URL);
  u.searchParams.set("tgWebAppStartParam", encodeStartParamPayload(payload));
  return u.toString();
}

/** Direct link `t.me/<bot>/<app>?startapp=` (uses env username + short name). */
export function directMiniAppLink(payload: StartParamPayload): string | null {
  return buildDirectMiniAppLink({
    botUsername: env.TELEGRAM_BOT_USERNAME,
    shortName: env.TELEGRAM_MINI_APP_SHORT_NAME,
    payload
  });
}

/** True when both deep-link env pieces resolve to non-empty strings. */
export function hasDirectMiniAppLinkConfig(): boolean {
  return Boolean(
    env.TELEGRAM_BOT_USERNAME?.trim() && env.TELEGRAM_MINI_APP_SHORT_NAME?.trim()
  );
}
