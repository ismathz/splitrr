import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
  validateWebAppInitDataDetailed
} from "@splitbot/shared";
import {
  readInitDataFromHeaders,
  readInitDataFromQuery
} from "./authInitData";

function signInitData(
  fields: Record<string, string>,
  botToken: string
): string {
  const params = new URLSearchParams(fields);
  const pairs = [...params.entries()]
    .filter(([k]) => k !== "hash" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("validateWebAppInitDataDetailed reasons", () => {
  const token = "123456:ABC-DEF";
  const now = 1_700_000_000;

  it("reports expired", () => {
    const initData = signInitData(
      {
        auth_date: String(now - 100_000),
        user: JSON.stringify({ id: 1, first_name: "A" })
      },
      token
    );
    const result = validateWebAppInitDataDetailed(initData, token, {
      nowSec: now,
      maxAgeSec: 3600
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("reports bad_hash when tampered", () => {
    const initData = signInitData(
      {
        auth_date: String(now),
        user: JSON.stringify({ id: 1, first_name: "A" })
      },
      token
    );
    const tampered = initData.replace("first_name", "first_namex");
    const result = validateWebAppInitDataDetailed(tampered, token, {
      nowSec: now,
      maxAgeSec: 3600
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_hash");
  });
});

describe("readInitData helpers", () => {
  it("reads Authorization tma and query tgWebAppData", () => {
    const initData = "user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc";
    const headerCtx = {
      req: {
        header: (name: string) =>
          name.toLowerCase() === "authorization" ? `tma ${initData}` : undefined,
        query: () => undefined
      }
    } as any;
    expect(readInitDataFromHeaders(headerCtx)).toBe(initData);

    const queryCtx = {
      req: {
        header: () => undefined,
        query: (name: string) =>
          name === "tgWebAppData" ? initData : undefined
      }
    } as any;
    expect(readInitDataFromQuery(queryCtx)).toBe(initData);
  });
});
