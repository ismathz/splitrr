import { describe, expect, it } from "bun:test";
import { encodeStartParamPayload } from "@splitbot/shared";
import { resolveGroupMembersChatId } from "./resolveGroupMembersChatId";

function initDataWithStartParam(cid: string): string {
  const start = encodeStartParamPayload({ cid });
  return `auth_date=1&start_param=${encodeURIComponent(start)}&user=${encodeURIComponent(
    JSON.stringify({ id: 1, first_name: "A" }),
  )}&hash=x`;
}

describe("resolveGroupMembersChatId", () => {
  it("uses initData cid when body is empty", () => {
    const r = resolveGroupMembersChatId({
      initData: initDataWithStartParam("-1001"),
    });
    expect(r).toEqual({ ok: true, chatId: "-1001" });
  });

  it("uses body telegramChatId when initData has no chat/cid", () => {
    const r = resolveGroupMembersChatId({
      initData: "auth_date=1&user=%7B%22id%22%3A1%7D&hash=x",
      telegramChatId: "-10042",
    });
    expect(r).toEqual({ ok: true, chatId: "-10042" });
  });

  it("rejects mismatch between initData and body", () => {
    const r = resolveGroupMembersChatId({
      initData: initDataWithStartParam("-1"),
      telegramChatId: "-2",
    });
    expect(r).toEqual({ ok: false, error: "chat_mismatch" });
  });

  it("returns missing_chat_id when neither source has a cid", () => {
    const r = resolveGroupMembersChatId({
      initData: "auth_date=1&hash=x",
    });
    expect(r).toEqual({ ok: false, error: "missing_chat_id" });
  });
});
