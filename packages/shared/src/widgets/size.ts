import { deflateSync } from "node:zlib";
import {
  WIDGET_DATA_MAX_BYTES,
  WIDGET_HTML_MAX_BYTES,
  WIDGET_HTML_MAX_COMPRESSED_BYTES
} from "./types";

/**
 * Telegram counts HTML with zlib level 9. Node's zlib can differ by a few
 * dozen bytes from Python's; stay under the limit with headroom in tests.
 */
export function widgetHtmlCompressedSize(html: string): number {
  return deflateSync(Buffer.from(html, "utf8"), { level: 9 }).byteLength;
}

export function assertWidgetHtmlBudget(html: string): {
  rawBytes: number;
  compressedBytes: number;
} {
  const rawBytes = Buffer.byteLength(html, "utf8");
  const compressedBytes = widgetHtmlCompressedSize(html);
  if (rawBytes > WIDGET_HTML_MAX_BYTES) {
    throw new Error(
      `widget HTML ${rawBytes}B exceeds ${WIDGET_HTML_MAX_BYTES}B raw limit`,
    );
  }
  if (compressedBytes > WIDGET_HTML_MAX_COMPRESSED_BYTES) {
    throw new Error(
      `widget HTML ${compressedBytes}B compressed exceeds ${WIDGET_HTML_MAX_COMPRESSED_BYTES}B`,
    );
  }
  return { rawBytes, compressedBytes };
}

export function assertWidgetDataBudget(data: string, label = "chat_data"): void {
  const n = Buffer.byteLength(data, "utf8");
  if (n > WIDGET_DATA_MAX_BYTES) {
    throw new Error(`${label} ${n}B exceeds ${WIDGET_DATA_MAX_BYTES}B`);
  }
}

/** Truncate UTF-8 string to at most `maxBytes` without splitting code points. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let out = text;
  while (out.length > 0 && Buffer.byteLength(out, "utf8") > maxBytes) {
    out = out.slice(0, -1);
  }
  return out;
}

/** JSON.stringify + drop keys until ≤ maxBytes (best-effort trim of arrays). */
export function compactJsonUnderBudget(
  value: unknown,
  maxBytes = WIDGET_DATA_MAX_BYTES,
): string {
  let json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) return json;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = { ...(value as Record<string, unknown>) };
    // Prefer trimming list fields used by our widgets.
    for (const key of ["owe", "owed", "items"] as const) {
      const arr = obj[key];
      if (!Array.isArray(arr)) continue;
      while (
        arr.length > 0 &&
        Buffer.byteLength(JSON.stringify(obj), "utf8") > maxBytes
      ) {
        arr.pop();
      }
    }
    if (typeof obj.pay === "string") {
      while (
        Buffer.byteLength(JSON.stringify(obj), "utf8") > maxBytes &&
        (obj.pay as string).length > 0
      ) {
        obj.pay = (obj.pay as string).slice(0, -1);
      }
      if (!(obj.pay as string)) delete obj.pay;
    }
    json = JSON.stringify(obj);
  }

  if (Buffer.byteLength(json, "utf8") > maxBytes) {
    // Last resort: empty object marker.
    return "{}";
  }
  return json;
}
