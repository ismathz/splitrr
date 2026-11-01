import type { Context } from "hono";
import { looksLikeWebAppInitData } from "@splitbot/shared";

export function asInitDataString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!looksLikeWebAppInitData(trimmed)) return null;
  return trimmed;
}

export function readInitDataFromHeaders(c: Context): string | null {
  const header = asInitDataString(c.req.header("x-telegram-init-data"));
  if (header) return header;
  const auth = c.req.header("Authorization");
  if (auth?.toLowerCase().startsWith("tma ")) {
    return asInitDataString(auth.slice(4));
  }
  return null;
}

export function readInitDataFromQuery(c: Context): string | null {
  return (
    asInitDataString(c.req.query("tgWebAppData")) ||
    asInitDataString(c.req.query("initData"))
  );
}

export type InitDataCandidate = {
  source:
    | "authorization"
    | "x-telegram-init-data"
    | "query.tgWebAppData"
    | "query.initData"
    | "form.initData"
    | "form._telegram_init_data";
  value: string;
};

/** Collect every plausible initData carrier (may include mangled copies). */
export function collectInitDataCandidates(
  c: Context,
  multipart: Record<string, string | File> | null
): InitDataCandidate[] {
  const out: InitDataCandidate[] = [];
  const seen = new Set<string>();

  const push = (source: InitDataCandidate["source"], raw: unknown) => {
    if (typeof raw !== "string") return;
    const value = raw.trim();
    if (!value || seen.has(value)) return;
    // Keep candidates even if they fail looksLike — validation will reject them.
    // Only skip empty.
    seen.add(value);
    out.push({ source, value });
  };

  // FormData first: Telegram WebViews often mangle Authorization / custom headers
  // on multipart uploads while leaving body fields intact.
  if (multipart) {
    push("form.initData", multipart.initData);
    push("form._telegram_init_data", multipart._telegram_init_data);
  }
  const auth = c.req.header("Authorization");
  if (auth?.toLowerCase().startsWith("tma ")) {
    push("authorization", auth.slice(4));
  }
  push("x-telegram-init-data", c.req.header("x-telegram-init-data"));
  push("query.tgWebAppData", c.req.query("tgWebAppData"));
  push("query.initData", c.req.query("initData"));
  return out;
}

/** Variants to try when intermediaries over/under-encode initData. */
export function expandInitDataVariants(raw: string): string[] {
  const variants: string[] = [];
  const add = (v: string) => {
    const t = v.trim();
    if (t && !variants.includes(t)) variants.push(t);
  };
  add(raw);
  // application/x-www-form-urlencoded often turns '+' into space.
  if (raw.includes(" ")) add(raw.replace(/ /g, "+"));
  try {
    const once = decodeURIComponent(raw);
    add(once);
    if (once.includes(" ")) add(once.replace(/ /g, "+"));
  } catch {
    /* ignore */
  }
  return variants;
}
