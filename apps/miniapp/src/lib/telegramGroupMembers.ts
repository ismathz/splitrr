import { useEffect, useState } from "react";

import { mockMembers } from "@/app/billMock";
import {
  logTelegramInitDataOnce,
  readTelegramLaunchContext,
} from "@/lib/telegramLaunchContext";

export type TelegramGroupMember = {
  tgUserId?: number;
  name: string;
  /**
   * Telegram-provided placeholder background colors for profile-photo
   * fallback avatars (RGB24 ints).
   *
   * When absent (start_param/env/dev mocks), the UI falls back to a local
   * deterministic color from the name.
   */
  avatarBgColors?: number[];
  /**
   * Signed path on the bot API (`GET /miniapp/avatar/...`) — prepend
   * `VITE_BOT_MINIAPP_API`. No bot token in the URL.
   */
  avatarProxyPath?: string;
  /** Direct HTTPS URL from Telegram WebApp `initDataUnsafe.user` (current user). */
  photoUrl?: string;
};

/** Members are auto-added to the bill when the Telegram group has at most this many members. */
export const AUTO_FILL_MAX_GROUP_SIZE = 10;

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = n.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Bot / launcher can pass members via Mini App `start_param` as JSON or base64 JSON:
 * `{"members":["Alice","Bob"],"cid":"-100..."}` or the same string in base64.
 */
/** True if `start_param` JSON/base64 JSON includes `cid` (group chat id from the bot). */
export function parseStartParamHasCid(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  const trimmed = raw.trim();

  const tryParse = (s: string): boolean => {
    try {
      const parsed: unknown = JSON.parse(s);
      if (parsed && typeof parsed === "object" && "cid" in parsed) {
        const v = (parsed as { cid?: unknown }).cid;
        return v != null && String(v).trim() !== "";
      }
    } catch {
      return false;
    }
    return false;
  };

  if (tryParse(trimmed)) return true;

  try {
    const pad = trimmed.length % 4 === 0 ? "" : "=".repeat(4 - (trimmed.length % 4));
    const decoded = atob(trimmed.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return tryParse(decoded);
  } catch {
    return false;
  }
}

export function parseMembersFromStartParam(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();

  const tryParse = (s: string): string[] | null => {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) {
        const names = parsed.map(String).filter(Boolean);
        return names.length ? dedupeNames(names) : null;
      }
      if (parsed && typeof parsed === "object" && "members" in parsed) {
        const m = (parsed as { members?: unknown }).members;
        if (Array.isArray(m)) {
          const names = m.map(String).filter(Boolean);
          return names.length ? dedupeNames(names) : null;
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  try {
    const pad = trimmed.length % 4 === 0 ? "" : "=".repeat(4 - (trimmed.length % 4));
    const decoded = atob(trimmed.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return tryParse(decoded);
  } catch {
    return null;
  }
}

function resolveTelegramGroupMembersSync(): TelegramGroupMember[] {
  if (typeof window === "undefined") return [];

  const params = new URLSearchParams(window.location.search);
  const membersParam = params.get("members");
  if (membersParam) {
    return dedupeNames(membersParam.split(",").map((s) => s.trim())).map((name) => ({
      name
    }));
  }

  const env = import.meta.env.VITE_TELEGRAM_GROUP_MEMBERS;
  if (typeof env === "string" && env.trim()) {
    return dedupeNames(env.split(",").map((s) => s.trim())).map((name) => ({
      name
    }));
  }

  logTelegramInitDataOnce();
  const ctx = readTelegramLaunchContext();
  const startParam = ctx.startParam;
  const fromStart = parseMembersFromStartParam(startParam);
  if (fromStart?.length) {
    return fromStart.map((name) => ({ name }));
  }

  if (import.meta.env.DEV) {
    return mockMembers.slice(0, 6).map((name) => ({ name }));
  }

  return [];
}

async function fetchMembersFromBotApi(
  initData: string,
): Promise<TelegramGroupMember[] | null> {
  const base = import.meta.env.VITE_BOT_MINIAPP_API;
  if (typeof base !== "string" || !base.trim()) return null;
  const url = `${base.replace(/\/$/, "")}/miniapp/group-members`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  if (!res.ok) return null;
  const data: unknown = await res.json();
  if (!data || typeof data !== "object" || !("members" in data)) return null;
  const m = (data as { members?: unknown }).members;
  if (!Array.isArray(m)) return null;

  const members: TelegramGroupMember[] = [];
  for (const row of m) {
    if (!row || typeof row !== "object") continue;
    const r = row as {
      tgUserId?: unknown;
      name?: unknown;
      avatarBgColors?: unknown;
      avatarProxyPath?: unknown;
    };
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;
    const tgUserId =
      typeof r.tgUserId === "number" && Number.isFinite(r.tgUserId)
        ? r.tgUserId
        : undefined;
    const avatarBgColors = Array.isArray(r.avatarBgColors)
      ? r.avatarBgColors.map((v) => (typeof v === "number" ? v : Number(v)))
      : undefined;
    const avatarProxyPath =
      typeof r.avatarProxyPath === "string" && r.avatarProxyPath.trim()
        ? r.avatarProxyPath.trim()
        : undefined;

    members.push({ tgUserId, name, avatarBgColors, avatarProxyPath });
  }

  // Dedupe by name, preserving the first occurrence.
  const seen = new Set<string>();
  const out: TelegramGroupMember[] = [];
  for (const mem of members) {
    const key = mem.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mem);
  }

  const ctx = readTelegramLaunchContext();
  const u = ctx.currentUser;
  if (u?.photo_url && u.id != null) {
    for (const mem of out) {
      if (mem.tgUserId === u.id) {
        mem.photoUrl = u.photo_url;
        break;
      }
    }
  }

  return out;
}

export type UseTelegramGroupMembersResult = {
  members: TelegramGroupMember[];
  isLoading: boolean;
};

/**
 * Resolves group member display names: query/env → `start_param` → optional bot API
 * (`VITE_BOT_MINIAPP_API` + validated `initData`; server uses mtcute `iterChatMembers`, best-effort) → dev mocks.
 */
export function useTelegramGroupMembers(): UseTelegramGroupMembersResult {
  const [launch, setLaunch] = useState(() => readTelegramLaunchContext());

  useEffect(() => {
    logTelegramInitDataOnce();
    const wa = (
      window as unknown as {
        Telegram?: { WebApp?: { ready?: () => void } };
      }
    ).Telegram?.WebApp;
    wa?.ready?.();
    queueMicrotask(() => setLaunch(readTelegramLaunchContext()));
  }, []);

  const [members, setMembers] = useState<TelegramGroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const base = import.meta.env.VITE_BOT_MINIAPP_API;
    const canFetch =
      typeof base === "string" &&
      base.trim().length > 0 &&
      Boolean(launch.initData?.trim());

    if (!canFetch) {
      setMembers(resolveTelegramGroupMembersSync());
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let cancelled = false;
    const sync = resolveTelegramGroupMembersSync();

    (async () => {
      try {
        const fromApi = await fetchMembersFromBotApi(launch.initData);
        if (cancelled) return;
        if (fromApi?.length) {
          setMembers(fromApi);
        } else if (sync.length) {
          setMembers(sync);
        } else {
          setMembers([]);
        }
      } catch {
        if (!cancelled) setMembers(sync.length ? sync : []);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [launch.initData]);

  return { members, isLoading };
}

/** @deprecated Prefer `useTelegramGroupMembers()` which returns `{ members, isLoading }`. */
export function readTelegramGroupMembers(): string[] {
  return resolveTelegramGroupMembersSync().map((m) => m.name);
}
