import { describe, expect, it } from "bun:test";
import { authorizeRosterChatAccess, displayNameFromWebAppUser } from "./roster";

describe("authorizeRosterChatAccess", () => {
  it("allows when no initData (dev bypass path)", () => {
    expect(
      authorizeRosterChatAccess({
        initData: null,
        telegramChatId: "-1001"
      })
    ).toEqual({ ok: true });
  });

  it("allows matching initData chat context", () => {
    const initData = new URLSearchParams({
      user: JSON.stringify({ id: 1, first_name: "A" }),
      chat: JSON.stringify({ id: -1001, type: "supergroup", title: "G" }),
      auth_date: "1",
      hash: "x"
    }).toString();
    expect(
      authorizeRosterChatAccess({
        initData,
        telegramChatId: "-1001"
      })
    ).toEqual({ ok: true });
  });

  it("rejects mismatched chat", () => {
    const initData = new URLSearchParams({
      user: JSON.stringify({ id: 1, first_name: "A" }),
      chat: JSON.stringify({ id: -1001, type: "supergroup", title: "G" }),
      auth_date: "1",
      hash: "x"
    }).toString();
    const result = authorizeRosterChatAccess({
      initData,
      telegramChatId: "-999"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("chat_mismatch");
      expect(result.status).toBe(403);
    }
  });

  it("allows when initData has no chat/cid (still authenticated)", () => {
    const initData = new URLSearchParams({
      user: JSON.stringify({ id: 1, first_name: "A" }),
      auth_date: "1",
      hash: "x"
    }).toString();
    expect(
      authorizeRosterChatAccess({
        initData,
        telegramChatId: "-1001"
      })
    ).toEqual({ ok: true });
  });
});

describe("displayNameFromWebAppUser", () => {
  it("prefers full name then username then id", () => {
    expect(
      displayNameFromWebAppUser({ id: 1, first_name: "Ada", last_name: "Lovelace" })
    ).toBe("Ada Lovelace");
    expect(displayNameFromWebAppUser({ id: 1, username: "ada" })).toBe("ada");
    expect(displayNameFromWebAppUser({ id: 42 })).toBe("42");
  });
});
