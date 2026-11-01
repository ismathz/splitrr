import type { Context } from "hono";

export function asInitDataString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
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
