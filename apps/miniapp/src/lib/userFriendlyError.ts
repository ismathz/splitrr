/**
 * Turn thrown values (often `Error.message`) into short, user-facing copy.
 * Avoids exposing raw fetch errors, status codes, and HTML bodies.
 */
export function toUserFriendlyErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);

  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  const lower = trimmed.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("fetch failed") ||
    lower.includes("net::err_") ||
    (err instanceof TypeError &&
      /fetch|network|load|failed/i.test(trimmed))
  ) {
    return "We couldn’t reach the server. Check your connection and try again.";
  }

  if (
    trimmed === "AbortError" ||
    lower.includes("aborted") ||
    lower.includes("signal is aborted")
  ) {
    return "The request was cancelled.";
  }

  if (trimmed.includes("<!DOCTYPE") || trimmed.includes("<html")) {
    return fallback;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      if (typeof o.message === "string" && o.message.trim()) {
        return sanitizeApiMessage(o.message.trim());
      }
      if (typeof o.error === "string" && o.error.trim()) {
        return sanitizeApiMessage(o.error.trim());
      }
    }
  } catch {
    // not JSON
  }

  if (/^create bill failed:\s*\d+/i.test(trimmed)) {
    return "We couldn’t create the bill on the server. Try again in a moment.";
  }
  if (/^upload receipt failed:\s*\d+/i.test(trimmed)) {
    return "We couldn’t upload the receipt image. Try again or choose a different photo.";
  }
  if (/^OCR failed:\s*\d+/i.test(trimmed)) {
    return "We couldn’t read the receipt. Try a clearer photo or add items manually.";
  }

  if (/^5\d\d\b/.test(trimmed) || /status:\s*5\d\d/i.test(trimmed)) {
    return "The server had a problem. Please try again in a moment.";
  }

  return sanitizeApiMessage(trimmed) ?? fallback;
}

function sanitizeApiMessage(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  if (t.length > 280) return null;
  if (/^[A-Z][a-zA-Z0-9]*Error$/.test(t)) return null;
  return t;
}
