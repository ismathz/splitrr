import { describe, expect, it } from "bun:test";
import { deflateSync } from "node:zlib";
import { ADDED_WIDGET_HTML } from "./addedHtml";
import { BALANCE_WIDGET_HTML } from "./balanceHtml";
import {
  assertWidgetDataBudget,
  assertWidgetHtmlBudget,
  compactJsonUnderBudget,
  widgetHtmlCompressedSize,
} from "./size";
import {
  ADDED_MARK_PAID_PREFIX,
  BALANCE_REFRESH_REQUEST,
  WIDGET_HTML_MAX_COMPRESSED_BYTES,
  WIDGET_REQUEST_MAX_BYTES,
  buildMarkPaidRequest,
  parseMarkPaidRequest,
  type AddedChatData,
  type BalanceChatData,
} from "./types";
import { formatAddedCaption, formatBalanceCaption } from "./captions";
import { sendWidget, sendWidgetOrText } from "./telegramApi";

describe("widget HTML size budget", () => {
  it("balance HTML fits raw + zlib level 9 limits", () => {
    const sizes = assertWidgetHtmlBudget(BALANCE_WIDGET_HTML);
    expect(sizes.rawBytes).toBeLessThanOrEqual(32768);
    expect(sizes.compressedBytes).toBeLessThanOrEqual(
      WIDGET_HTML_MAX_COMPRESSED_BYTES,
    );
    // Cross-check with explicit deflate level 9.
    const pyStyle = deflateSync(Buffer.from(BALANCE_WIDGET_HTML, "utf8"), {
      level: 9,
    }).byteLength;
    expect(pyStyle).toBe(widgetHtmlCompressedSize(BALANCE_WIDGET_HTML));
    expect(pyStyle).toBeLessThanOrEqual(WIDGET_HTML_MAX_COMPRESSED_BYTES);
  });

  it("added HTML fits raw + zlib level 9 limits", () => {
    const sizes = assertWidgetHtmlBudget(ADDED_WIDGET_HTML);
    expect(sizes.rawBytes).toBeLessThanOrEqual(32768);
    expect(sizes.compressedBytes).toBeLessThanOrEqual(
      WIDGET_HTML_MAX_COMPRESSED_BYTES,
    );
  });
});

describe("widget request payloads", () => {
  it("refresh + mark-paid stay within 1–64 bytes", () => {
    expect(Buffer.byteLength(BALANCE_REFRESH_REQUEST, "utf8")).toBeGreaterThanOrEqual(1);
    expect(Buffer.byteLength(BALANCE_REFRESH_REQUEST, "utf8")).toBeLessThanOrEqual(
      WIDGET_REQUEST_MAX_BYTES,
    );
    const billId = "123e4567-e89b-12d3-a456-426614174000";
    const payload = buildMarkPaidRequest(billId);
    expect(payload.startsWith(ADDED_MARK_PAID_PREFIX)).toBe(true);
    expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(
      WIDGET_REQUEST_MAX_BYTES,
    );
    expect(parseMarkPaidRequest(payload)).toBe(billId);
    expect(parseMarkPaidRequest("r")).toBeNull();
  });
});

describe("chat_data budget", () => {
  it("serializes sample balance + added payloads under 1KB", () => {
    const balance: BalanceChatData = {
      r: 1,
      owe: [
        {
          n: "Alice",
          a: 1250,
          c: "USD",
          b: "bill-1",
          g: "-1001",
          l: "Dinner",
        },
      ],
      owed: [
        {
          n: "Bob",
          a: 900,
          c: "USD",
          b: "bill-2",
          g: "-1002",
          l: "Taxi",
        },
      ],
      bot: "SplitrrBot",
      app: "app",
    };
    const balanceJson = compactJsonUnderBudget(balance);
    assertWidgetDataBudget(balanceJson);
    expect(formatBalanceCaption(balance)).toContain("Splitrr");
    expect(formatBalanceCaption(balance)).toContain("Your balance");

    const added: AddedChatData = {
      r: 1,
      t: "Dinner",
      c: "USD",
      s: 4520,
      paid: 0,
      items: [
        { n: "Pizza", a: 2000 },
        { n: "Salad", a: 1200 },
      ],
      pay: "Venmo @alice",
      bid: "bill-1",
      cid: "-1001",
      bot: "SplitrrBot",
      app: "app",
      mn: "Bob",
    };
    const addedJson = compactJsonUnderBudget(added);
    assertWidgetDataBudget(addedJson);
    expect(formatAddedCaption(added)).toContain("You've been added");
  });
});

describe("sendWidget caption omission", () => {
  it("omits caption from sendWidget body", async () => {
    const captured: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      captured.push(
        init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {},
      );
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 11 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await sendWidget("123:ABC", {
      chatId: 1,
      html: BALANCE_WIDGET_HTML,
      chatData: "{}",
    });
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toHaveProperty("caption");
    expect(captured[0]?.html).toBe(BALANCE_WIDGET_HTML);
  });

  it("falls back to textFallback via sendMessage only when sendWidget fails", async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const method = String(input).split("/").pop() ?? "unknown";
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      calls.push({ method, body });
      if (method === "sendWidget") {
        return new Response(
          JSON.stringify({ ok: false, description: "widgets_unavailable" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 12 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const fallback = formatBalanceCaption({
      r: 1,
      owe: [],
      owed: [],
      bot: "SplitrrBot",
      app: "app",
    });
    const result = await sendWidgetOrText("123:ABC", {
      chatId: 9,
      html: BALANCE_WIDGET_HTML,
      textFallback: fallback,
    });
    expect(result.mode).toBe("text");
    expect(result.messageId).toBe(12);
    const widgetCall = calls.find((c) => c.method === "sendWidget");
    expect(widgetCall?.body).not.toHaveProperty("caption");
    const textCall = calls.find((c) => c.method === "sendMessage");
    expect(String(textCall?.body.text ?? "")).toBe(fallback);
  });
});

describe("widget HTML titles", () => {
  it("does not embed Splitrr caption-style duplicate titles", () => {
    expect(BALANCE_WIDGET_HTML).not.toContain("Splitrr · Your balance");
    expect(BALANCE_WIDGET_HTML).not.toContain("Splitrr - your balance");
    expect(ADDED_WIDGET_HTML).not.toContain("Splitrr · You've been added");
    expect(ADDED_WIDGET_HTML).not.toContain("Splitrr - you've been added");
    // Card headings stay inside the widget UI only (not as sendWidget captions).
    expect(BALANCE_WIDGET_HTML).toContain("<h1>Your balance</h1>");
    // Apostrophe is escaped for the widget's single-quoted JS string.
    expect(ADDED_WIDGET_HTML).toContain("<h1>You\\'ve been added</h1>");
  });
});
