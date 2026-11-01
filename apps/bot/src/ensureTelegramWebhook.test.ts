import { describe, expect, it } from "bun:test";
import {
  buildWebhookUrl,
  ROSTER_ALLOWED_UPDATES,
  webhookAllowsRosterUpdates,
  type WebhookInfoSummary
} from "./ensureTelegramWebhook";

describe("buildWebhookUrl", () => {
  it("uses origin + secret path", () => {
    expect(
      buildWebhookUrl("https://splitrr.ismath.dev/app", "sec-1"),
    ).toBe("https://splitrr.ismath.dev/webhook/sec-1");
  });
});

describe("webhookAllowsRosterUpdates", () => {
  const base: WebhookInfoSummary = {
    url: "https://splitrr.ismath.dev/webhook/sec",
    allowedUpdates: [],
    pendingUpdateCount: 0,
    hasCustomCertificate: false,
    lastErrorMessage: null,
    lastErrorDate: null
  };

  it("rejects missing url", () => {
    expect(webhookAllowsRosterUpdates(null)).toBe(false);
    expect(webhookAllowsRosterUpdates({ ...base, url: null })).toBe(false);
  });

  it("rejects Telegram default (empty allowed_updates omits chat_member)", () => {
    expect(webhookAllowsRosterUpdates(base)).toBe(false);
  });

  it("requires both message and chat_member", () => {
    expect(
      webhookAllowsRosterUpdates({
        ...base,
        allowedUpdates: ["message", "callback_query"]
      }),
    ).toBe(false);
    expect(
      webhookAllowsRosterUpdates({
        ...base,
        allowedUpdates: ["chat_member"]
      }),
    ).toBe(false);
    expect(
      webhookAllowsRosterUpdates({
        ...base,
        allowedUpdates: [...ROSTER_ALLOWED_UPDATES]
      }),
    ).toBe(true);
  });
});
