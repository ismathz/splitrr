import type { Context, Next } from "hono";
import {
  parseTelegramUserFromInitData,
  telegramTokenFingerprint,
  validateWebAppInitDataDetailed,
  type TelegramWebAppUser
} from "@splitbot/shared";
import { env } from "./env";
import {
  collectInitDataCandidates,
  expandInitDataVariants,
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

async function maybeParseMultipart(
  c: Context
): Promise<Record<string, string | File> | null> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return null;
  }
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
    return flat;
  } catch (err) {
    console.warn("[auth] multipart parse for initData failed", err);
    return null;
  }
}

/**
 * Require valid Telegram WebApp initData on `/api/*` (except cron routes).
 *
 * Tries every carrier (Authorization, header, query, form) and encoding
 * variant until one HMAC-validates. First-non-empty was wrong when WebViews
 * mangled headers but left FormData intact.
 */
export async function requireTelegramAuth(c: Context, next: Next) {
  if (c.req.method === "OPTIONS") {
    return next();
  }

  const multipart = await maybeParseMultipart(c);
  c.set("parsedMultipart", multipart);

  const candidates = collectInitDataCandidates(c, multipart);
  const token = env.TELEGRAM_BOT_TOKEN;
  const tokenFp = telegramTokenFingerprint(token);

  if (token && candidates.length > 0) {
    const attempts: Array<{
      source: string;
      reason: string;
      len: number;
    }> = [];

    for (const candidate of candidates) {
      for (const variant of expandInitDataVariants(candidate.value)) {
        const result = validateWebAppInitDataDetailed(variant, token);
        attempts.push({
          source: candidate.source,
          reason: result.ok ? "ok" : result.reason,
          len: variant.length
        });
        if (result.ok) {
          const user = parseTelegramUserFromInitData(variant);
          c.set("telegramUser", user);
          c.set("initData", variant);
          c.set("authMode", "init_data");
          return next();
        }
      }
    }

    // Prefer actionable reasons when every carrier fails (token mismatch → bad_hash).
    const reason =
      attempts.find((a) => a.reason === "bad_hash")?.reason ??
      attempts.find((a) => a.reason === "expired")?.reason ??
      attempts.find((a) => a.reason === "auth_date_in_future")?.reason ??
      attempts[attempts.length - 1]?.reason ??
      "bad_hash";

    console.warn("[auth] invalid_init_data", {
      botId: tokenFp.botId,
      tokenSuffix: tokenFp.tokenSuffix,
      reason,
      attempts
    });
    return c.json(
      {
        error: "invalid_init_data",
        reason,
        attempts,
        tokenBotId: tokenFp.botId,
        tokenSuffix: tokenFp.tokenSuffix
      },
      401
    );
  }

  if (env.SPLITBOT_DEV_AUTH_BYPASS) {
    c.set("telegramUser", null);
    c.set("initData", null);
    c.set("authMode", "dev_bypass");
    return next();
  }

  console.warn("[auth] missing_init_data", {
    botId: tokenFp.botId,
    hasToken: Boolean(token),
    candidateCount: candidates.length
  });
  return c.json(
    {
      error: "missing_init_data",
      tokenBotId: tokenFp.botId,
      tokenSuffix: tokenFp.tokenSuffix
    },
    401
  );
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
