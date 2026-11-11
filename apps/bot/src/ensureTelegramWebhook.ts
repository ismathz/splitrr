/**
 * Register / refresh the Telegram webhook with the update types the roster needs.
 *
 * Telegram's default allowed_updates omits `chat_member`. Deploy does not call
 * setWebhook, so privacy / roster changes never re-registered the subscription
 * until we do it on every bot boot.
 */
export const ROSTER_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "my_chat_member",
  "chat_member",
  "widget_query"
] as const;

export type EnsureWebhookConfig = {
  botToken: string;
  webhookSecret: string;
  /** Mini App / public HTTPS origin (e.g. https://splitrr.ismath.dev). */
  webAppUrl: string;
};

export function buildWebhookUrl(webAppUrl: string, webhookSecret: string): string {
  const origin = new URL(webAppUrl).origin;
  return `${origin}/webhook/${webhookSecret}`;
}

export type WebhookInfoSummary = {
  url: string | null;
  allowedUpdates: string[];
  pendingUpdateCount: number | null;
  hasCustomCertificate: boolean | null;
  lastErrorMessage: string | null;
  lastErrorDate: number | null;
};

export async function fetchWebhookInfo(
  botToken: string,
): Promise<WebhookInfoSummary | null> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      result?: {
        url?: string;
        allowed_updates?: string[];
        pending_update_count?: number;
        has_custom_certificate?: boolean;
        last_error_message?: string;
        last_error_date?: number;
      };
    };
    if (!body.ok || !body.result) return null;
    const r = body.result;
    return {
      url: r.url?.trim() ? r.url : null,
      allowedUpdates: Array.isArray(r.allowed_updates) ? r.allowed_updates : [],
      pendingUpdateCount:
        typeof r.pending_update_count === "number" ? r.pending_update_count : null,
      hasCustomCertificate:
        typeof r.has_custom_certificate === "boolean"
          ? r.has_custom_certificate
          : null,
      lastErrorMessage: r.last_error_message ?? null,
      lastErrorDate: r.last_error_date ?? null
    };
  } catch {
    return null;
  }
}

export function webhookAllowsRosterUpdates(info: WebhookInfoSummary | null): boolean {
  if (!info?.url) return false;
  const allowed = info.allowedUpdates;
  // Empty allowed_updates means Telegram default: all except chat_member /
  // message_reaction / message_reaction_count — so message yes, chat_member no.
  // Explicit lists must also include widget_query for balance / added cards.
  if (allowed.length === 0) return false;
  return (
    allowed.includes("message") &&
    allowed.includes("chat_member") &&
    allowed.includes("widget_query")
  );
}

/**
 * Ensure the live webhook URL + allowed_updates include message and chat_member.
 * Idempotent; safe to call on every boot.
 */
export async function ensureTelegramWebhook(
  config: EnsureWebhookConfig,
): Promise<{
  ok: boolean;
  url: string;
  set: boolean;
  error?: string;
  before: WebhookInfoSummary | null;
  after: WebhookInfoSummary | null;
}> {
  const url = buildWebhookUrl(config.webAppUrl, config.webhookSecret);
  const before = await fetchWebhookInfo(config.botToken);

  const alreadyOk =
    before?.url === url && webhookAllowsRosterUpdates(before);

  if (!alreadyOk) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${config.botToken}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            secret_token: config.webhookSecret,
            allowed_updates: [...ROSTER_ALLOWED_UPDATES],
            drop_pending_updates: false
          })
        },
      );
      const body = (await res.json()) as { ok?: boolean; description?: string };
      if (!res.ok || !body.ok) {
        const error = body.description ?? `HTTP ${res.status}`;
        console.warn("[webhook] setWebhook failed", error);
        return {
          ok: false,
          url,
          set: false,
          error,
          before,
          after: await fetchWebhookInfo(config.botToken)
        };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "setWebhook_failed";
      console.warn("[webhook] setWebhook error", error);
      return {
        ok: false,
        url,
        set: false,
        error,
        before,
        after: null
      };
    }
  }

  const after = alreadyOk ? before : await fetchWebhookInfo(config.botToken);
  const ok = webhookAllowsRosterUpdates(after) && after?.url === url;
  if (ok) {
    console.log(
      "[webhook] ready",
      url,
      "allowed_updates=",
      after?.allowedUpdates?.join(",") || "(default)",
    );
  } else {
    console.warn(
      "[webhook] after setWebhook still missing roster updates",
      after,
    );
  }
  return { ok, url, set: !alreadyOk, before, after };
}
