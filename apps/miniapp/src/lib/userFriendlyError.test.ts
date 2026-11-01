import { describe, expect, it } from "bun:test";
import { toUserFriendlyErrorMessage } from "./userFriendlyError";

describe("toUserFriendlyErrorMessage auth", () => {
  it("maps invalid_init_data JSON to reopen guidance", () => {
    const msg = toUserFriendlyErrorMessage(
      new Error(JSON.stringify({ error: "invalid_init_data", reason: "bad_hash" })),
    );
    expect(msg.toLowerCase()).toContain("re-open");
    expect(msg.toLowerCase()).toContain("bad_hash");
  });

  it("maps missing_init_data", () => {
    const msg = toUserFriendlyErrorMessage(
      new Error(JSON.stringify({ error: "missing_init_data" })),
    );
    expect(msg.toLowerCase()).toContain("missing");
    expect(msg.toLowerCase()).toContain("/split");
  });
});
