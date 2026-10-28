import type { Context, Next } from "hono";
import {
  parseTelegramUserFromInitData,
  validateWebAppInitData,
  type TelegramWebAppUser
} from "@splitbot/shared";
import { env } from "./env";

export type ApiAuthVariables = {
  telegramUser: TelegramWebAppUser | null;
  initData: string | null;
  authMode: "init_data" | "dev_bypass" | "cron";
};

declare module "hono" {
  interface ContextVariableMap extends ApiAuthVariables {}
}

const INIT_DATA_HEADER = "x-telegram-init-data";

export function readInitData(c: Context): string | null {
  const header = c.req.header(INIT_DATA_HEADER)?.trim();
  if (header) return header;
  const auth = c.req.header("Authorization");
  if (auth?.toLowerCase().startsWith("tma ")) {
    const value = auth.slice(4).trim();
    return value || null;
  }
  return null;
}

/**
 * Require valid Telegram WebApp initData on `/api/*` (except cron routes).
 * In development, `SPLITBOT_DEV_AUTH_BYPASS=true` allows unauthenticated local use.
 */
export async function requireTelegramAuth(c: Context, next: Next) {
  if (c.req.method === "OPTIONS") {
    return next();
  }

  const initData = readInitData(c);
  if (initData && env.TELEGRAM_BOT_TOKEN) {
    if (!validateWebAppInitData(initData, env.TELEGRAM_BOT_TOKEN)) {
      return c.json({ error: "invalid_init_data" }, 401);
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
  return next();
}
