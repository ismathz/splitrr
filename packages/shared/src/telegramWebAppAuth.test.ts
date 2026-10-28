import { createHmac } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  parseTelegramChatIdFromInitData,
  parseTelegramUserFromInitData,
  validateWebAppInitData
} from "./telegramWebAppAuth";

function signInitData(
  fields: Record<string, string>,
  botToken: string
): string {
  const params = new URLSearchParams(fields);
  const pairs = [...params.entries()]
    .filter(([k]) => k !== "hash" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", botToken)
    .update("WebAppData")
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("validateWebAppInitData", () => {
  const token = "123456:ABC-DEF";

  it("accepts a fresh signed payload", () => {
    const now = 1_700_000_000;
    const initData = signInitData(
      {
        auth_date: String(now),
        user: JSON.stringify({ id: 42, first_name: "Ada" })
      },
      token
    );
    expect(
      validateWebAppInitData(initData, token, { nowSec: now, maxAgeSec: 3600 })
    ).toBe(true);
  });

  it("rejects expired auth_date", () => {
    const now = 1_700_000_000;
    const initData = signInitData(
      {
        auth_date: String(now - 10_000),
        user: JSON.stringify({ id: 42 })
      },
      token
    );
    expect(
      validateWebAppInitData(initData, token, { nowSec: now, maxAgeSec: 3600 })
    ).toBe(false);
  });

  it("rejects tampered payload", () => {
    const now = 1_700_000_000;
    const initData = signInitData(
      {
        auth_date: String(now),
        user: JSON.stringify({ id: 42 })
      },
      token
    );
    const tampered = initData.replace("42", "99");
    expect(
      validateWebAppInitData(tampered, token, { nowSec: now, maxAgeSec: 3600 })
    ).toBe(false);
  });
});

describe("parse helpers", () => {
  it("parses user and chat id from start_param", () => {
    const initData = new URLSearchParams({
      user: JSON.stringify({ id: 7, first_name: "Bob" }),
      start_param: JSON.stringify({ cid: "-1001" })
    }).toString();
    expect(parseTelegramUserFromInitData(initData)?.id).toBe(7);
    expect(parseTelegramChatIdFromInitData(initData)).toBe("-1001");
  });
});
