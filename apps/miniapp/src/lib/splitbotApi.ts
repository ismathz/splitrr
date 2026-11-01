import type { ParsedReceipt } from "@splitbot/shared";
import {
  looksLikeWebAppInitData,
  parseTelegramChatIdFromInitData,
} from "@splitbot/shared";

import type { TelegramLaunchContext } from "@/lib/telegramLaunchContext";
import { resolveLaunchTelegramChatId } from "@/lib/telegramLaunchContext";
import { parseTelegramChatIdFromStartParam } from "@/lib/telegramGroupMembers";

/** Base URL for `apps/api` (bills + OCR). Set `VITE_SPLITBOT_API`; DEV defaults to localhost:3000. */
export function getSplitbotApiBase(): string {
  const v = import.meta.env.VITE_SPLITBOT_API?.replace(/\/$/, "") ?? "";
  if (v) return v;
  if (import.meta.env.DEV) return "http://localhost:3000";
  return "";
}

/** Read `tgWebAppData` from query or hash (Telegram launch param). */
function readTgWebAppDataFromUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("tgWebAppData")?.trim();
    if (fromQuery) return fromQuery;
    const hashRaw = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    if (hashRaw) {
      const hashParams = new URLSearchParams(hashRaw);
      const fromHash = hashParams.get("tgWebAppData")?.trim();
      if (fromHash) return fromHash;
    }
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * Latest Telegram WebApp initData for API auth (empty outside Telegram).
 * Prefers `Telegram.WebApp.initData`, then URL `tgWebAppData` (query/hash).
 */
export function getTelegramInitData(): string {
  try {
    const wa = (
      window as Window & {
        Telegram?: { WebApp?: { initData?: string } };
      }
    ).Telegram?.WebApp;
    const fromWa = wa?.initData?.trim() ?? "";
    // Never fall back to start_param / unrelated URL junk — that yields bad_hash.
    if (fromWa && looksLikeWebAppInitData(fromWa)) return fromWa;
    const fromUrl = readTgWebAppDataFromUrl();
    if (fromUrl && looksLikeWebAppInitData(fromUrl)) return fromUrl;
    return "";
  } catch {
    return "";
  }
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const initData = getTelegramInitData();
  if (initData) {
    // Prefer the standard TMA Authorization scheme; keep the custom header too.
    headers.set("Authorization", `tma ${initData}`);
    headers.set("X-Telegram-Init-Data", initData);
  }
  return headers;
}

async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = authHeaders(init?.headers);
  return fetch(input, { ...init, headers });
}

/** Append initData as a multipart field (WebViews often drop custom headers on FormData). */
function appendInitDataToFormData(fd: FormData): void {
  const initData = getTelegramInitData();
  if (!initData) return;
  fd.append("initData", initData);
  fd.append("_telegram_init_data", initData);
}

export function resolveBillContextForApi(
  ctx: TelegramLaunchContext,
): { telegramChatId: string; groupTitle: string } | null {
  if (ctx.chat?.id != null) {
    return {
      telegramChatId: String(ctx.chat.id),
      groupTitle: ctx.chat.title?.trim() || "Group",
    };
  }
  // Prefer shared parser over start_param-only (handles initData chat + cid).
  const fromLaunch = resolveLaunchTelegramChatId(ctx);
  if (fromLaunch) {
    return { telegramChatId: fromLaunch, groupTitle: "Group" };
  }
  if (ctx.initData) {
    const fromInit = parseTelegramChatIdFromInitData(ctx.initData);
    if (fromInit) {
      return { telegramChatId: fromInit, groupTitle: "Group" };
    }
  }
  const cid = parseTelegramChatIdFromStartParam(ctx.startParam);
  if (cid) {
    return { telegramChatId: cid, groupTitle: "Group" };
  }
  // Explicit local override — never honored in production builds.
  if (import.meta.env.DEV) {
    const dev = import.meta.env.VITE_DEV_TELEGRAM_CHAT_ID;
    if (typeof dev === "string" && dev.trim()) {
      return { telegramChatId: dev.trim(), groupTitle: "Dev group" };
    }
  }
  // Private chat / Saved Messages: no `chat` object, but user id matches the DM chat id.
  const ct = ctx.chatType;
  if (
    (ct === "private" || ct === "sender") &&
    ctx.currentUser?.id != null
  ) {
    const u = ctx.currentUser;
    return {
      telegramChatId: String(u.id),
      groupTitle: u.first_name?.trim()
        ? `${u.first_name}'s chat`
        : "Private chat",
    };
  }
  // Vite DEV without Telegram WebApp: fixed id for local API testing.
  if (import.meta.env.DEV) {
    return { telegramChatId: "dev-local", groupTitle: "Local dev" };
  }
  // Production Mini App outside a Telegram launch context: no chat to bind.
  // (Standalone browser demos can still opt into DEV + mock flag locally.)
  return null;
}

export async function createBillSession(
  base: string,
  body: {
    telegramChatId: string;
    groupTitle: string;
    title: string;
    createdByUserId?: number;
    billDate?: string;
    place?: string | null;
    currency?: string;
  },
): Promise<{ billId: string; groupId: number }> {
  const res = await apiFetch(`${base}/api/bills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `create bill failed: ${res.status}`);
  }
  return res.json() as Promise<{ billId: string; groupId: number }>;
}

export async function uploadReceipt(
  base: string,
  billId: string,
  file: File,
): Promise<{ key: string; signedUrl: string }> {
  const initData = getTelegramInitData();
  if (!initData) {
    throw new Error(
      JSON.stringify({
        error: "missing_init_data",
        message:
          "Telegram login data is missing. Close Splitbot and re-open it from /split, then try again.",
      }),
    );
  }
  const fd = new FormData();
  fd.append("file", file);
  appendInitDataToFormData(fd);
  // Also pass initData on the query string — most resilient for Telegram WebViews.
  const qs = new URLSearchParams({ tgWebAppData: initData });
  const res = await apiFetch(
    `${base}/api/bills/${billId}/receipt?${qs.toString()}`,
    {
      method: "POST",
      body: fd,
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `upload receipt failed: ${res.status}`);
  }
  return res.json() as Promise<{ key: string; signedUrl: string }>;
}

export async function runReceiptOcr(
  base: string,
  billId: string,
  storageKey?: string,
): Promise<ParsedReceipt> {
  const res = await apiFetch(`${base}/api/bills/${billId}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(storageKey ? { storageKey } : {}),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `OCR failed: ${res.status}`);
  }
  return res.json() as Promise<ParsedReceipt>;
}

export type ApiBillDetails = {
  id: string;
  title: string;
  status: "draft" | "active" | "settled";
  currency: string;
  billDate: string;
  place: string | null;
  settled: boolean;
  items: Array<{
    id: string;
    name: string;
    totalPriceCents: number;
    assignees: string[];
  }>;
};

export type ApiBillHistoryEntry = {
  id: string;
  title: string;
  status: "draft" | "active" | "settled";
  currency: string;
  billDate: string;
  place: string | null;
  settled: boolean;
  createdAt?: string;
};

export type ApiBillPaymentStatusMember = {
  name: string;
  paid: boolean;
};

export type ApiGroupRosterMember = {
  tgUserId: number;
  name: string;
  username: string | null;
  photoUrl: string | null;
};

export type ApiGroupRoster = {
  members: ApiGroupRosterMember[];
  memberCount: number | null;
  seenCount: number;
  unseenCount: number | null;
  backfillError?: string | null;
};

export class GroupRosterRequestError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(body || `get group roster failed: ${status}`);
    this.name = "GroupRosterRequestError";
    this.status = status;
    this.body = body;
  }
}

/** Stored bot-visible roster for a Telegram group (initData auth). */
export async function getGroupRosterByTelegramChatId(
  base: string,
  telegramChatId: string,
  options?: { refresh?: boolean },
): Promise<ApiGroupRoster> {
  const qs = options?.refresh ? "?refresh=1" : "";
  const url = `${base}/api/groups/by-telegram-chat/${encodeURIComponent(telegramChatId)}/roster${qs}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new GroupRosterRequestError(res.status, t);
  }
  return res.json() as Promise<ApiGroupRoster>;
}

export async function getGroupHistoryByTelegramChatId(
  base: string,
  telegramChatId: string,
  createdByUserId?: number,
): Promise<{ bills: ApiBillHistoryEntry[] }> {
  const qs = new URLSearchParams();
  if (typeof createdByUserId === "number") {
    qs.set("createdByUserId", String(createdByUserId));
  }
  const query = qs.toString();
  const url = `${base}/api/groups/by-telegram-chat/${encodeURIComponent(telegramChatId)}/history${
    query ? `?${query}` : ""
  }`;

  const res = await apiFetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `get group history failed: ${res.status}`);
  }
  return res.json() as Promise<{ bills: ApiBillHistoryEntry[] }>;
}

export async function getBillDetails(
  base: string,
  billId: string,
): Promise<ApiBillDetails> {
  const res = await apiFetch(`${base}/api/bills/${billId}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `get bill failed: ${res.status}`);
  }
  return res.json() as Promise<ApiBillDetails>;
}

export async function updateBillDetails(
  base: string,
  billId: string,
  body: {
    title: string;
    billDate?: string;
    place?: string | null;
    items?: Array<{
      id?: string;
      name: string;
      totalPriceCents: number;
      assignees?: string[];
    }>;
  },
): Promise<{ ok: true }> {
  const res = await apiFetch(`${base}/api/bills/${billId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `update bill failed: ${res.status}`);
  }
  return res.json() as Promise<{ ok: true }>;
}

export async function deleteBill(base: string, billId: string): Promise<{ ok: true }> {
  const res = await apiFetch(`${base}/api/bills/${billId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `delete bill failed: ${res.status}`);
  }
  return res.json() as Promise<{ ok: true }>;
}

export async function getBillPaymentStatus(
  base: string,
  billId: string,
): Promise<{ members: ApiBillPaymentStatusMember[] }> {
  const res = await apiFetch(`${base}/api/bills/${billId}/payment-status`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `get payment status failed: ${res.status}`);
  }
  return res.json() as Promise<{ members: ApiBillPaymentStatusMember[] }>;
}

export async function updateBillPaymentStatus(
  base: string,
  billId: string,
  body: { name: string; paid: boolean },
): Promise<{ ok: true }> {
  const res = await apiFetch(`${base}/api/bills/${billId}/payment-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `update payment status failed: ${res.status}`);
  }
  return res.json() as Promise<{ ok: true }>;
}

export async function computeBillSettlements(
  base: string,
  billId: string,
  paidByUserId?: number,
): Promise<{ ok: true; transfers: number }> {
  const res = await apiFetch(`${base}/api/bills/${billId}/settlements/compute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      typeof paidByUserId === "number" ? { paidByUserId } : {},
    ),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `compute settlements failed: ${res.status}`);
  }
  return res.json() as Promise<{ ok: true; transfers: number }>;
}

/** Post a bill summary (+ reopen deep link) into the bound Telegram group. */
export async function announceBillToGroup(
  base: string,
  billId: string,
): Promise<{ ok: true; openUrl?: string | null }> {
  const res = await apiFetch(`${base}/api/bills/${billId}/announce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `announce bill failed: ${res.status}`);
  }
  return res.json() as Promise<{ ok: true; openUrl?: string | null }>;
}
