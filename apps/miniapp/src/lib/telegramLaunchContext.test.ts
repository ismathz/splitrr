import { afterEach, describe, expect, it } from "bun:test";
import { encodeStartParamPayload } from "@splitbot/shared";
import {
  readTgWebAppStartParamFromUrl,
  resolveLaunchTelegramChatId,
  readTelegramLaunchContext,
} from "./telegramLaunchContext";

describe("readTgWebAppStartParamFromUrl", () => {
  afterEach(() => {
    // jsdom/bun may not have a full window location; set via history when available.
  });

  it("reads tgWebAppStartParam from query string", () => {
    const encoded = encodeStartParamPayload({ cid: "-10042" });
    const href = `https://splitrr.ismath.dev/?tgWebAppStartParam=${encoded}`;
    const url = new URL(href);
    expect(url.searchParams.get("tgWebAppStartParam")).toBe(encoded);
    // Function uses window.location — stub via redefine when present.
    const original = globalThis.window;
    (globalThis as any).window = {
      location: { href },
    };
    try {
      expect(readTgWebAppStartParamFromUrl()).toBe(encoded);
    } finally {
      (globalThis as any).window = original;
    }
  });

  it("reads tgWebAppStartParam from hash fragment", () => {
    const encoded = encodeStartParamPayload({ cid: "-10099" });
    const href = `https://splitrr.ismath.dev/#tgWebAppStartParam=${encoded}&tgWebAppVersion=8.0`;
    const original = globalThis.window;
    (globalThis as any).window = {
      location: { href },
    };
    try {
      expect(readTgWebAppStartParamFromUrl()).toBe(encoded);
    } finally {
      (globalThis as any).window = original;
    }
  });
});

describe("resolveLaunchTelegramChatId", () => {
  it("prefers chat.id then start_param cid", () => {
    expect(
      resolveLaunchTelegramChatId({
        initData: "",
        initDataUnsafe: null,
        startParam: encodeStartParamPayload({ cid: "-1" }),
        chatType: "supergroup",
        chatInstance: undefined,
        chat: { id: -55, type: "supergroup", title: "G" },
        receiver: undefined,
        currentUser: undefined,
      }),
    ).toBe("-55");

    expect(
      resolveLaunchTelegramChatId({
        initData: "",
        initDataUnsafe: null,
        startParam: encodeStartParamPayload({ cid: "-1001" }),
        chatType: "group",
        chatInstance: undefined,
        chat: undefined,
        receiver: undefined,
        currentUser: undefined,
      }),
    ).toBe("-1001");
  });

  it("parses cid from raw initData when unsafe chat is missing", () => {
    const start = encodeStartParamPayload({ cid: "-777" });
    const initData = new URLSearchParams({
      user: JSON.stringify({ id: 1, first_name: "A" }),
      start_param: start,
    }).toString();
    expect(
      resolveLaunchTelegramChatId({
        initData,
        initDataUnsafe: null,
        startParam: undefined,
        chatType: undefined,
        chatInstance: undefined,
        chat: undefined,
        receiver: undefined,
        currentUser: undefined,
      }),
    ).toBe("-777");
  });
});

describe("readTelegramLaunchContext currentUser fallback", () => {
  it("parses user from initData when initDataUnsafe.user is missing", () => {
    const initData = new URLSearchParams({
      user: JSON.stringify({
        id: 9,
        first_name: "Ismath",
        username: "ismath",
        photo_url: "https://example.com/p.jpg",
      }),
      start_param: encodeStartParamPayload({ cid: "-5" }),
    }).toString();

    const original = globalThis.window;
    (globalThis as any).window = {
      location: { href: "https://splitrr.ismath.dev/" },
      Telegram: {
        WebApp: {
          initData,
          initDataUnsafe: { start_param: encodeStartParamPayload({ cid: "-5" }) },
          ready: () => {},
        },
      },
    };
    try {
      const ctx = readTelegramLaunchContext();
      expect(ctx.currentUser?.id).toBe(9);
      expect(ctx.currentUser?.first_name).toBe("Ismath");
      expect(ctx.currentUser?.photo_url).toBe("https://example.com/p.jpg");
      expect(ctx.startParam).toBeTruthy();
    } finally {
      (globalThis as any).window = original;
    }
  });
});
