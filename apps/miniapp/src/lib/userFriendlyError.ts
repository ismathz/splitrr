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
      if (typeof o.error === "string") {
        const authMsg = authErrorMessage(o.error, o.reason, o);
        if (authMsg) return authMsg;
        const pipelineMsg = pipelineErrorMessage(o.error, o);
        if (pipelineMsg) return pipelineMsg;
      }
      if (typeof o.message === "string" && o.message.trim()) {
        const msg = o.message.trim();
        if (msg.toLowerCase() !== "internal_error") {
          return sanitizeApiMessage(msg) ?? fallback;
        }
      }
      if (typeof o.error === "string" && o.error.trim()) {
        const pipelineMsg = pipelineErrorMessage(o.error, o);
        if (pipelineMsg) return pipelineMsg;
        return sanitizeApiMessage(o.error.trim()) ?? fallback;
      }
    }
  } catch {
    // not JSON
  }

  if (lower.includes("invalid_init_data") || lower.includes("missing_init_data")) {
    return (
      authErrorMessage(
        lower.includes("missing") ? "missing_init_data" : "invalid_init_data",
      ) ?? fallback
    );
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

function authErrorMessage(
  error: string,
  reason?: unknown,
  extras?: Record<string, unknown>,
): string | null {
  const code = error.trim().toLowerCase();
  const botHint =
    typeof extras?.tokenBotId === "string" && extras.tokenBotId.trim()
      ? ` API bot id ${extras.tokenBotId.trim()}.`
      : "";
  if (code === "missing_init_data") {
    return `Telegram login data is missing. Close Splitbot and re-open it from /split, then try again.${botHint}`;
  }
  if (code === "invalid_init_data") {
    const why =
      typeof reason === "string" && reason.trim()
        ? ` (${reason.trim()})`
        : "";
    return `Telegram login expired or invalid${why}. Close Splitbot and re-open from /split. If this keeps happening, the VPS API TELEGRAM_BOT_TOKEN must match @SplitrrBot.${botHint}`;
  }
  return null;
}

function pipelineErrorMessage(
  error: string,
  extras?: Record<string, unknown>,
): string | null {
  const rawCode = String(extras?.code ?? error).trim().toLowerCase();
  // onError used to put Error.name in `code` (e.g. "Error"); treat as internal.
  const code =
    rawCode === "error" || rawCode === "typeerror" || rawCode === "internal_error"
      ? "internal_error"
      : rawCode;
  const detail =
    typeof extras?.message === "string" && extras.message.trim()
      ? extras.message.trim()
      : typeof extras?.error === "string" &&
          extras.error.trim().toLowerCase() !== "internal_error"
        ? extras.error.trim()
        : null;

  if (code === "internal_error") {
    return (
      detail ??
      "The server hit an internal error while handling the receipt. Try JPEG/PNG again, or check /api/pipeline/last-failures."
    );
  }
  if (
    code.startsWith("storage_") ||
    code.startsWith("openai_") ||
    code.startsWith("openrouter_") ||
    code === "ocr_failed" ||
    code === "ocr_unreadable" ||
    code === "ocr_schema_mismatch" ||
    code === "unsupported_ocr_mime" ||
    code === "create_bill_failed" ||
    code === "create_bill_fk" ||
    code === "missing_storage_key"
  ) {
    return detail ?? "Receipt upload or scan failed. Try again in a moment.";
  }
  if (code === "invalid_receipt_file" || code === "file_required") {
    return detail ?? "That image couldn’t be uploaded. Try a JPEG or PNG under 10 MB.";
  }
  if (code === "rate_limited" || code === "local_rate_limited") {
    return detail ?? "Too many scans just now. Wait a moment and try again.";
  }
  if (
    code === "openrouter_quota_exhausted" ||
    code === "openai_quota_exhausted"
  ) {
    return (
      detail ??
      "OpenRouter has no credit/quota for OCR. Add credits for OPENROUTER_API_KEY, then retry."
    );
  }
  return null;
}
