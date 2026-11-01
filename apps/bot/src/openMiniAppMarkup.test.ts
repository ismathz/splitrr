import { describe, expect, it } from "bun:test";
import { buildOpenMiniAppReplyMarkup } from "./openMiniAppMarkup";

describe("buildOpenMiniAppReplyMarkup", () => {
  it("uses web_app button in private chats", () => {
    const markup = buildOpenMiniAppReplyMarkup({
      chatType: "private",
      miniUrl: "https://splitrr.ismath.dev/?tgWebAppStartParam=abc",
      directUrl: "https://t.me/SplitrrBot/app?startapp=abc"
    });
    expect(markup).toEqual({
      inline_keyboard: [
        [
          {
            text: "Open Splitrr",
            web_app: {
              url: "https://splitrr.ismath.dev/?tgWebAppStartParam=abc"
            }
          }
        ]
      ]
    });
  });

  it("uses url deep link in groups when directUrl is set", () => {
    const markup = buildOpenMiniAppReplyMarkup({
      chatType: "supergroup",
      miniUrl: "https://splitrr.ismath.dev/?tgWebAppStartParam=abc",
      directUrl: "https://t.me/SplitrrBot/app?startapp=abc"
    });
    expect(markup).toEqual({
      inline_keyboard: [
        [
          {
            text: "Open Splitrr",
            url: "https://t.me/SplitrrBot/app?startapp=abc"
          }
        ]
      ]
    });
  });

  it("returns undefined in groups when deep-link env is missing", () => {
    const markup = buildOpenMiniAppReplyMarkup({
      chatType: "group",
      miniUrl: "https://splitrr.ismath.dev/",
      directUrl: null
    });
    expect(markup).toBeUndefined();
  });
});
