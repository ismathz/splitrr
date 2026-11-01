import { createHmac } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  buildDirectMiniAppLink,
  encodeStartParamPayload,
  parseBillIdFromStartParam,
  parseChatIdFromStartParam,
  parseTelegramChatIdFromInitData,
  parseTelegramUserFromInitData,
  validateWebAppInitData,
  validateWebAppInitDataDetailed,
  WEBAPP_HMAC_ALGO
} from "./telegramWebAppAuth";

/** Sign like Telegram / @telegram-apps/init-data-node: exclude only `hash`. */
function signInitData(
  fields: Record<string, string>,
  botToken: string
): string {
  const params = new URLSearchParams(fields);
  const pairs = [...params.entries()]
    .filter(([k]) => k !== "hash")
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("validateWebAppInitData", () => {
  const token = "123456:ABC-DEF";

  it("matches Telegram docs secret_key (WebAppData as HMAC key)", () => {
    // https://docs.telegram-mini-apps.com/platform/init-data
    const docsToken = "5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8";
    const secretHex = createHmac("sha256", "WebAppData")
      .update(docsToken)
      .digest("hex");
    expect(secretHex).toBe(
      "a5c609aa52f63cb5e6d8ceb6e4138726ea82bbc36bb786d64482d445ea38ee5f"
    );

    const dataCheckString = [
      "auth_date=1662771648",
      "query_id=AAHdF6IQAAAAAN0XohDhrOrc",
      'user={"id":279058397,"first_name":"Vladislav","last_name":"Kibenko","username":"vdkfrost","language_code":"ru","is_premium":true}'
    ].join("\n");
    const secretKey = createHmac("sha256", "WebAppData")
      .update(docsToken)
      .digest();
    const hash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");
    expect(hash).toBe(
      "c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2"
    );

    const initData = new URLSearchParams({
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
      user: JSON.stringify({
        id: 279058397,
        first_name: "Vladislav",
        last_name: "Kibenko",
        username: "vdkfrost",
        language_code: "ru",
        is_premium: true
      }),
      auth_date: "1662771648",
      hash
    }).toString();
    expect(
      validateWebAppInitData(initData, docsToken, {
        nowSec: 1662771648 + 60,
        maxAgeSec: 3600
      })
    ).toBe(true);
  });

  it("exports live HMAC algo marker", () => {
    expect(WEBAPP_HMAC_ALGO).toBe("WebAppData-as-key-v2-include-signature");
  });

  it("accepts modern initData that includes Ed25519 signature field", () => {
    // Real Telegram clients always send `signature` next to `hash`. The HMAC
    // data-check-string must INCLUDE signature (only hash is excluded).
    const now = 1_700_000_000;
    const initData = signInitData(
      {
        auth_date: String(now),
        user: JSON.stringify({ id: 42, first_name: "Ada" }),
        signature:
          "zL-ucjNyREiHDE8aihFwpfR9aggP2xiAo3NSpfe-p7IbCisNlDKlo7Kb6G4D0Ao2mBrSgEk4maLSdv6MLIlADQ",
        chat_type: "group",
        chat_instance: "8134722200314281151"
      },
      token
    );
    expect(initData).toContain("signature=");
    expect(
      validateWebAppInitData(initData, token, { nowSec: now, maxAgeSec: 3600 })
    ).toBe(true);
  });

  it("rejects when signature was wrongly omitted from the signed check string", () => {
    // Simulates the pre-fix bug: hash computed without signature, but payload has signature.
    const now = 1_700_000_000;
    const fields = {
      auth_date: String(now),
      user: JSON.stringify({ id: 42, first_name: "Ada" }),
      signature: "dummy-ed25519-signature"
    };
    const params = new URLSearchParams(fields);
    const wrongPairs = [...params.entries()]
      .filter(([k]) => k !== "hash" && k !== "signature")
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
    const wrongHash = createHmac("sha256", secretKey)
      .update(wrongPairs.join("\n"))
      .digest("hex");
    params.set("hash", wrongHash);
    expect(
      validateWebAppInitDataDetailed(params.toString(), token, {
        nowSec: now,
        maxAgeSec: 3600
      })
    ).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("reports bad_hash when token does not match signer", () => {
    const now = Math.floor(Date.now() / 1000);
    const initData = signInitData(
      {
        auth_date: String(now),
        user: JSON.stringify({ id: 1, first_name: "A" })
      },
      token
    );
    expect(
      validateWebAppInitDataDetailed(initData, "999999:WRONG-TOKEN", {
        nowSec: now,
        maxAgeSec: 3600
      })
    ).toEqual({ ok: false, reason: "bad_hash" });
  });

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

  it("round-trips encodeStartParamPayload cid", () => {
    const encoded = encodeStartParamPayload({ cid: "-1001234567890" });
    expect(parseChatIdFromStartParam(encoded)).toBe("-1001234567890");
  });

  it("round-trips encodeStartParamPayload bid", () => {
    const encoded = encodeStartParamPayload({
      cid: "-1001",
      bid: "bill-abc"
    });
    expect(parseChatIdFromStartParam(encoded)).toBe("-1001");
    expect(parseBillIdFromStartParam(encoded)).toBe("bill-abc");
  });

  it("decodes bid without Node Buffer (Mini App / WebView)", () => {
    const encoded = encodeStartParamPayload({
      cid: "-1001",
      bid: "bill-webview"
    });
    const original = globalThis.Buffer;
    // Simulate browser bundle: Vite does not polyfill Buffer.
    Reflect.deleteProperty(globalThis, "Buffer");
    try {
      expect(parseBillIdFromStartParam(encoded)).toBe("bill-webview");
      expect(parseChatIdFromStartParam(encoded)).toBe("-1001");
    } finally {
      Object.defineProperty(globalThis, "Buffer", {
        value: original,
        configurable: true,
        writable: true
      });
    }
  });

  it("prefers chat.id over start_param", () => {
    const initData = new URLSearchParams({
      chat: JSON.stringify({ id: -55, title: "Dinner" }),
      start_param: encodeStartParamPayload({ cid: "-99" })
    }).toString();
    expect(parseTelegramChatIdFromInitData(initData)).toBe("-55");
  });
});

describe("buildDirectMiniAppLink", () => {
  it("builds t.me deep link", () => {
    const payload = { cid: "-1001" };
    const url = buildDirectMiniAppLink({
      botUsername: "SplitrrBot",
      shortName: "app",
      payload
    });
    expect(url).toBe(
      `https://t.me/SplitrrBot/app?startapp=${encodeStartParamPayload(payload)}`
    );
  });

  it("strips leading @ from username", () => {
    const url = buildDirectMiniAppLink({
      botUsername: "@SplitrrBot",
      shortName: "app",
      payload: { cid: "1" }
    });
    expect(url?.startsWith("https://t.me/SplitrrBot/app?startapp=")).toBe(true);
  });

  it("returns null when short name missing", () => {
    expect(
      buildDirectMiniAppLink({
        botUsername: "SplitrrBot",
        shortName: "",
        payload: { cid: "1" }
      })
    ).toBeNull();
  });
});
