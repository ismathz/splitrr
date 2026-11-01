import { describe, expect, it } from "bun:test";
import {
  authorizeBillAnnounce,
  buildBillAnnounceOpenUrl,
  formatAnnounceBillDate,
  formatAnnouncePersonMention,
  formatBillAnnounceMessage,
  type BillAnnounceRow
} from "./announce";
import { encodeStartParamPayload } from "@splitbot/shared";

const bill: BillAnnounceRow = {
  billId: "bill-1",
  title: "Dinner",
  status: "active",
  currency: "USD",
  billDate: "2026-10-30",
  place: "Cafe",
  telegramChatId: "-1001"
};

describe("authorizeBillAnnounce", () => {
  it("allows matching initData chat context", () => {
    const initData = new URLSearchParams({
      user: JSON.stringify({ id: 9 }),
      start_param: encodeStartParamPayload({ cid: "-1001" })
    }).toString();
    expect(
      authorizeBillAnnounce(bill, {
        authMode: "init_data",
        initData,
        telegramUserId: 9
      })
    ).toEqual({ ok: true });
  });

  it("rejects chat mismatch", () => {
    const initData = new URLSearchParams({
      user: JSON.stringify({ id: 9 }),
      start_param: encodeStartParamPayload({ cid: "-9999" })
    }).toString();
    const result = authorizeBillAnnounce(bill, {
      authMode: "init_data",
      initData,
      telegramUserId: 9
    });
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "chat_mismatch"
    });
  });

  it("rejects missing telegram user outside bypass", () => {
    const result = authorizeBillAnnounce(bill, {
      authMode: "init_data",
      initData: null,
      telegramUserId: null
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "missing_telegram_user"
    });
  });

  it("allows local auth bypass", () => {
    expect(
      authorizeBillAnnounce(bill, {
        authMode: "dev_bypass",
        initData: null,
        telegramUserId: null
      })
    ).toEqual({ ok: true });
  });
});

describe("formatAnnounceBillDate", () => {
  it("formats ISO dates nicely", () => {
    expect(formatAnnounceBillDate("2026-10-30")).toBe("Fri, Oct 30, 2026");
  });

  it("passes through non-ISO values", () => {
    expect(formatAnnounceBillDate("soon")).toBe("soon");
  });
});

describe("formatAnnouncePersonMention", () => {
  it("uses @username when available", () => {
    expect(
      formatAnnouncePersonMention({
        displayName: "Ada",
        username: "ada_lovelace"
      })
    ).toBe("@ada_lovelace");
  });

  it("uses tg mention link when only user id is known", () => {
    expect(
      formatAnnouncePersonMention({
        displayName: "Ada",
        telegramUserId: 42
      })
    ).toBe('<a href="tg://user?id=42">Ada</a>');
  });

  it("falls back to escaped plain name", () => {
    expect(
      formatAnnouncePersonMention({
        displayName: "A & B <C>"
      })
    ).toBe("A &amp; B &lt;C&gt;");
  });
});

describe("formatBillAnnounceMessage", () => {
  it("includes totals, nice date, people tags, and open url", () => {
    const text = formatBillAnnounceMessage(bill, {
      itemCount: 3,
      totalCents: 1250,
      openUrl: "https://t.me/SplitrrBot/app?startapp=x",
      people: [
        { displayName: "Ada", username: "ada" },
        { displayName: "Bob", telegramUserId: 7 }
      ]
    });
    expect(text).toContain("Dinner");
    expect(text).toContain("Date: Fri, Oct 30, 2026");
    expect(text).toContain("With: @ada, <a href=\"tg://user?id=7\">Bob</a>");
    expect(text).toContain("USD 12.50");
    expect(text).toContain("Items: 3");
    expect(text).toContain("https://t.me/SplitrrBot/app?startapp=x");
  });
});

describe("buildBillAnnounceOpenUrl", () => {
  it("builds deep link for the group cid and bill id", () => {
    const url = buildBillAnnounceOpenUrl({
      botUsername: "SplitrrBot",
      shortName: "app",
      telegramChatId: "-1001",
      billId: "bill-1"
    });
    expect(url).toBe(
      `https://t.me/SplitrrBot/app?startapp=${encodeStartParamPayload({
        cid: "-1001",
        bid: "bill-1"
      })}`
    );
  });
});
