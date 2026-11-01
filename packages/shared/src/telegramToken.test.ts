import { describe, expect, it } from "bun:test";
import {
  looksLikeWebAppInitData,
  normalizeTelegramBotToken,
  telegramTokenFingerprint
} from "./telegramToken";

describe("telegramTokenFingerprint", () => {
  it("exposes bot id and last 4 of secret only", () => {
    expect(telegramTokenFingerprint("123456:AAHEsecretXYZ9")).toEqual({
      configured: true,
      botId: "123456",
      tokenSuffix: "XYZ9"
    });
  });

  it("strips wrapping quotes", () => {
    expect(normalizeTelegramBotToken('"123:ABC"')).toBe("123:ABC");
  });
});

describe("looksLikeWebAppInitData", () => {
  it("requires hash and auth_date", () => {
    expect(
      looksLikeWebAppInitData("user=%7B%7D&auth_date=1&hash=abc")
    ).toBe(true);
    expect(looksLikeWebAppInitData("eyJjaWQiOiItMTAwIn0")).toBe(false);
  });
});
