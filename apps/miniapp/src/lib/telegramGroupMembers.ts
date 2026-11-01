import { useEffect, useState } from "react";

import { mockMembers } from "@/app/billDevMocks";
import { isDevMockDataEnabled } from "@/lib/devFlags";
import {
  getGroupRosterByTelegramChatId,
  getSplitbotApiBase,
  GroupRosterRequestError,
  resolveBillContextForApi,
} from "@/lib/splitbotApi";
import {
  logTelegramInitDataOnce,
  readTelegramLaunchContext,
} from "@/lib/telegramLaunchContext";

export type TelegramGroupMember = {
  tgUserId?: number;
  name: string;
  username?: string | null;
  /**
   * Telegram-provided placeholder background colors for profile-photo
   * fallback avatars (RGB24 ints).
   *
   * When absent (start_param / opt-in dev mocks), the UI falls back to a local
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

export type RosterLoadStatus =
  | "idle"
  | "loading"
  | "ok"
  | "no_context"
  | "auth_error"
  | "empty"
  | "error";

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

/** Telegram group chat id from bot `start_param` JSON/base64 JSON (`cid`). */
export function parseTelegramChatIdFromStartParam(
  raw: string | undefined,
): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();

  const tryParse = (s: string): string | null => {
    try {
      const parsed: unknown = JSON.parse(s);
      if (parsed && typeof parsed === "object" && "cid" in parsed) {
        const v = (parsed as { cid?: unknown }).cid;
        if (v != null && String(v).trim() !== "") return String(v).trim();
      }
    } catch {
      return null;
    }
    return null;
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  try {
    const pad =
      trimmed.length % 4 === 0 ? "" : "=".repeat(4 - (trimmed.length % 4));
    const decoded = atob(trimmed.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return tryParse(decoded);
  } catch {
    return null;
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

  // Query/env member overrides are local-dev only (never in production builds).
  if (isDevMockDataEnabled()) {
    const params = new URLSearchParams(window.location.search);
    const membersParam = params.get("members");
    if (membersParam) {
      return dedupeNames(membersParam.split(",").map((s) => s.trim())).map(
        (name) => ({ name }),
      );
    }

    const env = import.meta.env.VITE_TELEGRAM_GROUP_MEMBERS;
    if (typeof env === "string" && env.trim()) {
      return dedupeNames(env.split(",").map((s) => s.trim())).map((name) => ({
        name,
      }));
    }
  }

  logTelegramInitDataOnce();
  const ctx = readTelegramLaunchContext();
  const startParam = ctx.startParam;
  const fromStart = parseMembersFromStartParam(startParam);
  if (fromStart?.length) {
    return fromStart.map((name) => ({ name }));
  }

  if (isDevMockDataEnabled()) {
    return mockMembers.slice(0, 6).map((name) => ({ name }));
  }

  return [];
}

function displayNameFromLaunchUser(
  u: { id: number; first_name?: string; last_name?: string; username?: string } | undefined,
): string | null {
  if (!u) return null;
  const first = u.first_name?.trim() ?? "";
  const last = u.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  if (full) return full;
  if (u.username?.trim()) return u.username.trim();
  return String(u.id);
}

function withCurrentUser(
  members: TelegramGroupMember[],
  launch: ReturnType<typeof readTelegramLaunchContext>,
): TelegramGroupMember[] {
  const u = launch.currentUser;
  const selfName = displayNameFromLaunchUser(u);
  if (u?.id == null || !selfName) return members;

  const existing = members.find((m) => m.tgUserId === u.id);
  if (existing) {
    existing.photoUrl = existing.photoUrl ?? u.photo_url;
    existing.username = existing.username ?? u.username ?? null;
    return members;
  }
  return [
    {
      tgUserId: u.id,
      name: selfName,
      username: u.username ?? null,
      photoUrl: u.photo_url,
    },
    ...members,
  ];
}

async function fetchMembersFromBotApi(
  initData: string,
  telegramChatId?: string | null,
): Promise<TelegramGroupMember[] | null> {
  const base = import.meta.env.VITE_BOT_MINIAPP_API;
  if (typeof base !== "string" || !base.trim()) return null;
  const url = `${base.replace(/\/$/, "")}/miniapp/group-members`;
  const payload: { initData: string; telegramChatId?: string } = { initData };
  if (telegramChatId?.trim()) {
    payload.telegramChatId = telegramChatId.trim();
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

function mergeMemberLists(
  primary: TelegramGroupMember[],
  secondary: TelegramGroupMember[],
): TelegramGroupMember[] {
  const byId = new Map<number, TelegramGroupMember>();
  const byName = new Map<string, TelegramGroupMember>();
  const out: TelegramGroupMember[] = [];

  const push = (mem: TelegramGroupMember) => {
    const nameKey = mem.name.toLowerCase();
    if (mem.tgUserId != null && byId.has(mem.tgUserId)) {
      const existing = byId.get(mem.tgUserId)!;
      existing.photoUrl = existing.photoUrl ?? mem.photoUrl;
      existing.avatarProxyPath = existing.avatarProxyPath ?? mem.avatarProxyPath;
      existing.avatarBgColors = existing.avatarBgColors ?? mem.avatarBgColors;
      existing.username = existing.username ?? mem.username;
      return;
    }
    if (byName.has(nameKey)) {
      const existing = byName.get(nameKey)!;
      existing.tgUserId = existing.tgUserId ?? mem.tgUserId;
      existing.photoUrl = existing.photoUrl ?? mem.photoUrl;
      existing.avatarProxyPath = existing.avatarProxyPath ?? mem.avatarProxyPath;
      existing.avatarBgColors = existing.avatarBgColors ?? mem.avatarBgColors;
      existing.username = existing.username ?? mem.username;
      if (mem.tgUserId != null && existing.tgUserId != null) {
        byId.set(existing.tgUserId, existing);
      }
      return;
    }
    const copy = { ...mem };
    out.push(copy);
    byName.set(nameKey, copy);
    if (copy.tgUserId != null) byId.set(copy.tgUserId, copy);
  };

  for (const m of primary) push(m);
  for (const m of secondary) push(m);
  return out;
}

export type UseTelegramGroupMembersResult = {
  members: TelegramGroupMember[];
  isLoading: boolean;
  /** Telegram getChatMemberCount when known; otherwise null. */
  memberCount: number | null;
  seenCount: number;
  /** max(0, memberCount - seenCount) when memberCount is known. */
  unseenCount: number | null;
  status: RosterLoadStatus;
  /** Short reason for empty/error UI (privacy, auth, missing cid, …). */
  statusMessage: string | null;
};

/**
 * Resolves group members for add-members UI:
 * stored API roster (bot-visible + admin backfill) → optional mtcute enrichment →
 * start_param → opt-in DEV mocks.
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
    const timeouts = [50, 150, 400, 1000, 2000].map((ms) =>
      setTimeout(() => setLaunch(readTelegramLaunchContext()), ms),
    );
    return () => timeouts.forEach(clearTimeout);
  }, []);

  const [members, setMembers] = useState<TelegramGroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [seenCount, setSeenCount] = useState(0);
  const [unseenCount, setUnseenCount] = useState<number | null>(null);
  const [status, setStatus] = useState<RosterLoadStatus>("loading");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const apiBase = getSplitbotApiBase();
    const billCtx = resolveBillContextForApi(launch);
    const botBase = import.meta.env.VITE_BOT_MINIAPP_API;
    const hasInitData = Boolean(launch.initData?.trim());
    const canFetchRoster =
      Boolean(apiBase) && Boolean(billCtx?.telegramChatId) && hasInitData;
    const canFetchBot =
      typeof botBase === "string" && botBase.trim().length > 0 && hasInitData;

    if (!canFetchRoster && !canFetchBot) {
      const sync = withCurrentUser(resolveTelegramGroupMembersSync(), launch);
      setMembers(sync);
      setSeenCount(sync.length);
      setMemberCount(null);
      setUnseenCount(null);
      setIsLoading(false);
      if (!hasInitData) {
        setStatus("no_context");
        setStatusMessage(
          "Open Splitrr from Telegram via /split in the group so it can load the roster.",
        );
      } else if (!billCtx?.telegramChatId) {
        setStatus("no_context");
        setStatusMessage(
          "Missing group id (startapp cid). Re-open with /split in the group.",
        );
      } else if (!apiBase) {
        setStatus("error");
        setStatusMessage("Mini App was built without VITE_SPLITBOT_API.");
      } else if (sync.length) {
        setStatus("ok");
        setStatusMessage(null);
      } else {
        setStatus("empty");
        setStatusMessage(
          "No members yet. Run /split in the group. For a fuller list: BotFather → /setprivacy → Disable, or make @SplitrrBot a group admin, then re-run /split.",
        );
      }
      return;
    }

    setIsLoading(true);
    setStatus("loading");
    let cancelled = false;
    const sync = resolveTelegramGroupMembersSync();

    (async () => {
      try {
        let rosterMembers: TelegramGroupMember[] = [];
        let nextMemberCount: number | null = null;
        let nextUnseen: number | null = null;
        let rosterStatus: RosterLoadStatus | null = null;
        let rosterMessage: string | null = null;

        if (canFetchRoster && billCtx) {
          try {
            const roster = await getGroupRosterByTelegramChatId(
              apiBase,
              billCtx.telegramChatId,
            );
            rosterMembers = roster.members.map((m) => ({
              tgUserId: m.tgUserId,
              name: m.name,
              username: m.username,
              photoUrl: m.photoUrl ?? undefined,
            }));
            nextMemberCount = roster.memberCount;
            nextUnseen = roster.unseenCount;
            if (!rosterMembers.length) {
              rosterStatus = "empty";
              rosterMessage =
                "No members yet. Run /split in the group. If the list stays empty: BotFather → /setprivacy → Disable, or make @SplitrrBot a group admin so it can see ordinary messages.";
            }
          } catch (err) {
            rosterMembers = [];
            if (err instanceof GroupRosterRequestError && (err.status === 401 || err.status === 403)) {
              rosterStatus = "auth_error";
              rosterMessage =
                "Could not authorize with Telegram. Close and re-open Splitrr from /split.";
            } else {
              rosterStatus = "error";
              rosterMessage =
                "Could not load the group roster. Check your connection and try again.";
            }
            console.warn("[splitrr] roster fetch failed", err);
          }
        }

        let botMembers: TelegramGroupMember[] = [];
        if (canFetchBot) {
          try {
            botMembers =
              (await fetchMembersFromBotApi(
                launch.initData,
                billCtx?.telegramChatId ?? null,
              )) ?? [];
          } catch {
            botMembers = [];
          }
        }

        if (cancelled) return;

        let merged = mergeMemberLists(rosterMembers, botMembers);
        if (!merged.length && sync.length) {
          merged = sync;
        }
        merged = withCurrentUser(merged, launch);

        setMembers(merged);
        setSeenCount(merged.length);
        setMemberCount(nextMemberCount);
        setUnseenCount(
          nextUnseen != null
            ? nextUnseen
            : nextMemberCount != null
              ? Math.max(0, nextMemberCount - merged.length)
              : null,
        );

        if (merged.length > 0) {
          setStatus("ok");
          setStatusMessage(
            nextMemberCount != null && merged.length < nextMemberCount
              ? `Showing ${merged.length} of ${nextMemberCount} people the bot has seen. Telegram does not give bots a full member list — add missing people by name, or BotFather → /setprivacy → Disable / make @SplitrrBot a group admin so more appear over time.`
              : null,
          );
        } else if (rosterStatus) {
          setStatus(rosterStatus);
          setStatusMessage(rosterMessage);
        } else {
          setStatus("empty");
          setStatusMessage(
            "No members yet. Run /split in the group. For a fuller list: BotFather → /setprivacy → Disable, or make @SplitrrBot a group admin.",
          );
        }
      } catch (err) {
        if (!cancelled) {
          const fallback = withCurrentUser(sync.length ? sync : [], launch);
          setMembers(fallback);
          setSeenCount(fallback.length);
          setMemberCount(null);
          setUnseenCount(null);
          setStatus(fallback.length ? "ok" : "error");
          setStatusMessage(
            fallback.length
              ? null
              : "Could not load members. Re-open from /split in the group.",
          );
          console.warn("[splitrr] group members resolve failed", err);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    launch.initData,
    launch.currentUser?.id,
    launch.startParam,
    launch.chat?.id,
    launch.chatType,
  ]);

  return {
    members,
    isLoading,
    memberCount,
    seenCount,
    unseenCount,
    status,
    statusMessage,
  };
}

/** @deprecated Prefer `useTelegramGroupMembers()` which returns `{ members, isLoading }`. */
export function readTelegramGroupMembers(): string[] {
  return resolveTelegramGroupMembersSync().map((m) => m.name);
}
