import type { ParsedReceipt } from "@splitbot/shared";

import type { TelegramLaunchContext } from "@/lib/telegramLaunchContext";
import { parseTelegramChatIdFromStartParam } from "@/lib/telegramGroupMembers";

const STANDALONE_WEB_CHAT_STORAGE_KEY = "splitbot_standalone_telegram_chat_id";

let standaloneChatIdWithoutStorage: string | null = null;

/** Stable per-browser id for bills created outside Telegram (hosted web, no Mini App). */
function getOrCreateStandaloneWebTelegramChatId(): string {
  try {
    let id = localStorage.getItem(STANDALONE_WEB_CHAT_STORAGE_KEY);
    if (!id?.trim()) {
      id = `web-${crypto.randomUUID()}`;
      localStorage.setItem(STANDALONE_WEB_CHAT_STORAGE_KEY, id);
    }
    return id.trim();
  } catch {
    // private mode / quota: one id for this page load
    if (!standaloneChatIdWithoutStorage) {
      standaloneChatIdWithoutStorage = `web-${crypto.randomUUID()}`;
    }
    return standaloneChatIdWithoutStorage;
  }
}

/** Base URL for `apps/api` (bills + OCR). Set `VITE_SPLITBOT_API`; dev defaults to localhost:3000. */
export function getSplitbotApiBase(): string {
  const v = import.meta.env.VITE_SPLITBOT_API?.replace(/\/$/, "") ?? "";
  if (v) return v;
  if (import.meta.env.DEV) return "http://localhost:3000";
  return "";
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
  const cid = parseTelegramChatIdFromStartParam(ctx.startParam);
  if (cid) {
    return { telegramChatId: cid, groupTitle: "Group" };
  }
  const dev = import.meta.env.VITE_DEV_TELEGRAM_CHAT_ID;
  if (typeof dev === "string" && dev.trim()) {
    return { telegramChatId: dev.trim(), groupTitle: "Dev group" };
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
  // Vite dev server without Telegram WebApp: fixed id for local API testing.
  if (import.meta.env.DEV) {
    return { telegramChatId: "dev-local", groupTitle: "Local dev" };
  }
  // Hosted or production web build: no Telegram; use a per-browser synthetic group.
  if (typeof window !== "undefined") {
    return {
      telegramChatId: getOrCreateStandaloneWebTelegramChatId(),
      groupTitle: "Web",
    };
  }
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
  const res = await fetch(`${base}/api/bills`, {
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
): Promise<{ signedUrl: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${base}/api/bills/${billId}/receipt`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `upload receipt failed: ${res.status}`);
  }
  return res.json() as Promise<{ signedUrl: string }>;
}

export async function runReceiptOcr(
  base: string,
  billId: string,
  imageUrl: string,
): Promise<ParsedReceipt> {
  const res = await fetch(`${base}/api/bills/${billId}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
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

  const res = await fetch(url);
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
  const res = await fetch(`${base}/api/bills/${billId}`);
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
  const res = await fetch(`${base}/api/bills/${billId}`, {
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
  const res = await fetch(`${base}/api/bills/${billId}`, {
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
  const res = await fetch(`${base}/api/bills/${billId}/payment-status`);
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
  const res = await fetch(`${base}/api/bills/${billId}/payment-status`, {
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
