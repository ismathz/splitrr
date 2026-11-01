import type { Context, Next } from "hono";
import {
  parseTelegramUserFromInitData,
  validateWebAppInitDataDetailed,
  type TelegramWebAppUser
} from "@splitbot/shared";
import { env } from "./env";
import {
  asInitDataString,
  readInitDataFromHeaders,
  readInitDataFromQuery
} from "./authInitData";

export type ApiAuthVariables = {
  telegramUser: TelegramWebAppUser | null;
  initData: string | null;
  authMode: "init_data" | "dev_bypass" | "cron";
  /** Multipart body parsed during auth so routes can reuse it. */
  parsedMultipart: Record<string, string | File> | null;
};

declare module "hono" {
  interface ContextVariableMap extends ApiAuthVariables {}
}

export { readInitDataFromHeaders, readInitDataFromQuery } from "./authInitData";

/**
 * Require valid Telegram WebApp initData on `/api/*` (except cron routes).
 * In development, `SPLITBOT_DEV_AUTH_BYPASS=true` allows unauthenticated local use.
 *
 * Accepts initData from (in order):
 * 1. `Authorization: tma <initData>`
 * 2. `X-Telegram-Init-Data`
 * 3. Query `tgWebAppData` / `initData` (multipart-safe fallback)
 * 4. Multipart field `initData` / `_telegram_init_data` (Telegram WebViews often
 *    mangle custom headers on FormData uploads)
 */
export async function requireTelegramAuth(c: Context, next: Next) {
  if (c.req.method === "OPTIONS") {
    return next();
  }

  c.set("parsedMultipart", null);

  let initData =
    readInitDataFromHeaders(c) || readInitDataFromQuery(c) || null;

  const contentType = c.req.header("content-type") ?? "";
  if (
    !initData &&
    contentType.toLowerCase().includes("multipart/form-data")
  ) {
    try {
      const parsed = await c.req.parseBody({ all: true });
      const flat: Record<string, string | File> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) {
          const first = value[0];
          if (typeof first === "string" || first instanceof File) {
            flat[key] = first;
          }
        } else if (typeof value === "string" || value instanceof File) {
          flat[key] = value;
        }
      }
      c.set("parsedMultipart", flat);
      initData =
        asInitDataString(flat.initData) ||
        asInitDataString(flat._telegram_init_data) ||
        null;
    } catch (err) {
      console.warn("[auth] multipart parse for initData failed", err);
    }
  }

  if (initData && env.TELEGRAM_BOT_TOKEN) {
    const result = validateWebAppInitDataDetailed(
      initData,
      env.TELEGRAM_BOT_TOKEN
    );
    if (!result.ok) {
      console.warn("[auth] invalid_init_data", result.reason);
      return c.json(
        { error: "invalid_init_data", reason: result.reason },
        401
      );
    }
    const user = parseTelegramUserFromInitData(initData);
    c.set("telegramUser", user);
    c.set("initData", initData);
    c.set("authMode", "init_data");
    return next();
  }

  if (env.SPLITBOT_DEV_AUTH_BYPASS) {
    c.set("telegramUser", null);
    c.set("initData", null);
    c.set("authMode", "dev_bypass");
    return next();
  }

  return c.json({ error: "missing_init_data" }, 401);
}

/** Protect cron-style endpoints with a shared secret header. */
export async function requireCronSecret(c: Context, next: Next) {
  const expected = env.REMINDER_CRON_SECRET;
  if (!expected) {
    return c.json({ error: "reminders_disabled" }, 503);
  }
  const provided =
    c.req.header("x-cron-secret")?.trim() ||
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!provided || provided !== expected) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("authMode", "cron");
  c.set("telegramUser", null);
  c.set("initData", null);
  c.set("parsedMultipart", null);
  return next();
}
