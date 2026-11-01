import { useEffect, useState } from "react";
import {
  parseChatIdFromStartParam,
  parseTelegramChatIdFromInitData,
  parseTelegramUserFromInitData,
} from "@splitbot/shared";

/**
 * Telegram Mini App launch context from `Telegram.WebApp.initDataUnsafe` and URL params.
 * @see https://core.telegram.org/bots/webapps#webappinitdata
 */

export type TelegramWebAppChatType =
  | "sender"
  | "private"
  | "group"
  | "supergroup"
  | "channel";

export interface TelegramWebAppChat {
  id: number;
  type: "group" | "supergroup" | "channel";
  title: string;
  username?: string;
  photo_url?: string;
}

export interface TelegramWebAppUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: true;
  photo_url?: string;
}

/** Parsed `initDataUnsafe` (do not trust for auth; validate `initData` on the server). */
export interface TelegramInitDataUnsafe {
  query_id?: string;
  user?: TelegramWebAppUser;
  receiver?: TelegramWebAppUser;
  chat?: TelegramWebAppChat;
  chat_type?: TelegramWebAppChatType;
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  auth_date?: number;
  hash?: string;
}

export interface TelegramLaunchContext {
  /** Raw query string from `Telegram.WebApp.initData` (for server validation). */
  initData: string;
  initDataUnsafe: TelegramInitDataUnsafe | null;
  /** From `initDataUnsafe`, raw initData, or URL `tgWebAppStartParam` (query or hash). */
  startParam: string | undefined;
  chatType: TelegramWebAppChatType | undefined;
  chatInstance: string | undefined;
  chat: TelegramWebAppChat | undefined;
  receiver: TelegramWebAppUser | undefined;
  currentUser: TelegramWebAppUser | undefined;
}

let debugLogged = false;

function getTelegramWebApp(): {
  initData?: string;
  initDataUnsafe?: TelegramInitDataUnsafe;
  ready?: () => void;
} | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window as unknown as {
      Telegram?: {
        WebApp?: {
          initData?: string;
          initDataUnsafe?: TelegramInitDataUnsafe;
          ready?: () => void;
        };
      };
    }
  ).Telegram?.WebApp;
}

/**
 * Reads `tgWebAppStartParam` from the page URL.
 * Telegram may put it in the query string and/or the hash fragment.
 */
export function readTgWebAppStartParamFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("tgWebAppStartParam")?.trim();
    if (q) return q;

    const hashRaw = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    if (hashRaw) {
      // Hash may be `tgWebAppStartParam=…&…` or nested under other params.
      const hashParams = new URLSearchParams(hashRaw);
      const fromHash = hashParams.get("tgWebAppStartParam")?.trim();
      if (fromHash) return fromHash;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function readStartParamFromInitData(initData: string): string | undefined {
  if (!initData.trim()) return undefined;
  try {
    return new URLSearchParams(initData).get("start_param")?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function readUserFromInitData(initData: string): TelegramWebAppUser | undefined {
  const parsed = parseTelegramUserFromInitData(initData);
  if (!parsed?.id) return undefined;
  return {
    id: parsed.id,
    first_name: parsed.first_name ?? "",
    last_name: parsed.last_name,
    username: parsed.username,
    photo_url: parsed.photo_url,
  };
}

/**
 * One-shot debug log of init data (enable with `VITE_TELEGRAM_DEBUG_INIT=true`).
 */
export function logTelegramInitDataOnce(): void {
  if (typeof window === "undefined" || debugLogged) return;
  const enabled =
    import.meta.env.VITE_TELEGRAM_DEBUG_INIT === "true" ||
    import.meta.env.DEV;
  if (!enabled) return;

  debugLogged = true;
  const wa = getTelegramWebApp();
  wa?.ready?.();

  const payload = {
    initDataLength: wa?.initData?.length ?? 0,
    initDataUnsafe: wa?.initDataUnsafe ?? null,
    tgWebAppStartParam: readTgWebAppStartParamFromUrl(),
    resolvedStartParam: getEffectiveStartParam(),
    resolvedChatId: resolveLaunchTelegramChatId(readTelegramLaunchContext()),
  };
  console.info("[splitbot] Telegram.WebApp init snapshot", payload);
}

/**
 * Effective `start_param`: URL (query/hash) → initDataUnsafe → raw initData.
 */
export function getEffectiveStartParam(): string | undefined {
  const wa = getTelegramWebApp();
  wa?.ready?.();
  const fromUrl = readTgWebAppStartParamFromUrl();
  if (fromUrl) return fromUrl;
  const fromUnsafe = wa?.initDataUnsafe?.start_param?.trim();
  if (fromUnsafe) return fromUnsafe;
  const initData = wa?.initData?.trim() ?? "";
  return readStartParamFromInitData(initData);
}

/**
 * Best-effort Telegram chat id for API calls: initData chat/`cid`, unsafe chat, then start_param.
 */
export function resolveLaunchTelegramChatId(
  ctx: TelegramLaunchContext,
): string | null {
  if (ctx.chat?.id != null) return String(ctx.chat.id);
  if (ctx.initData) {
    const fromInit = parseTelegramChatIdFromInitData(ctx.initData);
    if (fromInit) return fromInit;
  }
  if (ctx.startParam) {
    const fromStart = parseChatIdFromStartParam(ctx.startParam);
    if (fromStart) return fromStart;
  }
  return null;
}

export function readTelegramLaunchContext(): TelegramLaunchContext {
  const wa = getTelegramWebApp();
  wa?.ready?.();

  const initData = wa?.initData?.trim() ?? "";
  const unsafe = wa?.initDataUnsafe ?? null;
  const startParam =
    readTgWebAppStartParamFromUrl() ??
    unsafe?.start_param?.trim() ??
    readStartParamFromInitData(initData) ??
    undefined;

  const fromInitUser = initData ? readUserFromInitData(initData) : undefined;
  const unsafeUser = unsafe?.user;
  const currentUser: TelegramWebAppUser | undefined = unsafeUser
    ? {
        ...unsafeUser,
        // Prefer cheap photo_url from whichever source provides it.
        photo_url: unsafeUser.photo_url ?? fromInitUser?.photo_url,
      }
    : fromInitUser;

  return {
    initData,
    initDataUnsafe: unsafe,
    startParam,
    chatType: unsafe?.chat_type,
    chatInstance: unsafe?.chat_instance,
    chat: unsafe?.chat,
    receiver: unsafe?.receiver,
    currentUser,
  };
}

/** True when the app was opened in a group or supergroup context (best-effort). */
export function isGroupLikeLaunch(ctx: TelegramLaunchContext): boolean {
  const t = ctx.chatType;
  if (t === "group" || t === "supergroup") return true;
  const ct = ctx.chat?.type;
  if (ct === "group" || ct === "supergroup") return true;
  // Direct-link opens often omit `chat` but include a group `cid` in start_param.
  if (resolveLaunchTelegramChatId(ctx) && t !== "private" && t !== "sender") {
    const cid = resolveLaunchTelegramChatId(ctx);
    if (cid && (cid.startsWith("-") || cid.length > 10)) return true;
  }
  return false;
}

/** Heuristic: Saved Messages chat id often equals the user's Telegram id. */
export function isLikelySavedMessages(ctx: TelegramLaunchContext): boolean {
  const uid = ctx.currentUser?.id;
  const chatId = ctx.chat?.id;
  if (uid == null || chatId == null) return false;
  return uid === chatId;
}

/** Re-reads context after `Telegram.WebApp.ready()` (init fields may populate late). */
export function useTelegramLaunchContext(): TelegramLaunchContext {
  const [ctx, setCtx] = useState(() => readTelegramLaunchContext());

  useEffect(() => {
    const wa = (
      window as unknown as {
        Telegram?: { WebApp?: { ready?: () => void } };
      }
    ).Telegram?.WebApp;
    wa?.ready?.();
    const refresh = () => setCtx(readTelegramLaunchContext());
    queueMicrotask(refresh);
    // `initDataUnsafe.chat` / start_param can appear shortly after `ready()` on some clients.
    const timeouts = [50, 150, 400, 1000, 2000].map((ms) =>
      setTimeout(refresh, ms),
    );
    return () => timeouts.forEach(clearTimeout);
  }, []);

  return ctx;
}
