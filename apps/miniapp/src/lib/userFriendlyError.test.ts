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

  it("surfaces API token bot id hint when present", () => {
    const msg = toUserFriendlyErrorMessage(
      new Error(
        JSON.stringify({
          error: "invalid_init_data",
          reason: "bad_hash",
          tokenBotId: "7123456789",
          tokenSuffix: "Ab12"
        }),
      ),
    );
    expect(msg).toContain("7123456789");
  });

  it("maps missing_init_data", () => {
    const msg = toUserFriendlyErrorMessage(
      new Error(JSON.stringify({ error: "missing_init_data" })),
    );
    expect(msg.toLowerCase()).toContain("missing");
    expect(msg.toLowerCase()).toContain("/split");
  });

  it("maps internal_error to actionable copy", () => {
    const msg = toUserFriendlyErrorMessage(
      new Error(
        JSON.stringify({
          error: "internal_error",
          code: "internal_error",
          message: "Storage or OCR backend failed.",
        }),
      ),
    );
    expect(msg.toLowerCase()).toContain("storage");
  });

  it("maps onError code Error + receipt message", () => {
    const msg = toUserFriendlyErrorMessage(
      new Error(
        JSON.stringify({
          error: "internal_error",
          code: "Error",
          message: "Something went wrong while processing the receipt.",
        }),
      ),
    );
    expect(msg.toLowerCase()).toContain("receipt");
  });

  it("maps storage_checksum_rejected", () => {
    const msg = toUserFriendlyErrorMessage(
      new Error(
        JSON.stringify({
          error: "Receipt storage rejected the upload (S3 checksum).",
          code: "storage_checksum_rejected",
        }),
      ),
    );
    expect(msg.toLowerCase()).toContain("checksum");
  });

  it("maps openrouter_quota_exhausted distinctly from rate limits", () => {
    const msg = toUserFriendlyErrorMessage(
      new Error(
        JSON.stringify({
          error:
            "OpenRouter account has no usable credit/quota for OCR. Add credits at openrouter.ai for the OPENROUTER_API_KEY on the API host, then retry.",
          code: "openrouter_quota_exhausted",
          openrouterCode: "insufficient_credits",
        }),
      ),
    );
    expect(msg.toLowerCase()).toContain("credit");
    expect(msg.toLowerCase()).not.toContain("minute");
  });
});
