import { describe, expect, it } from "bun:test";
import { classifyOpenRouterError } from "./pipelineErrors";
import { classifyStorageError } from "./storage";

describe("classifyStorageError", () => {
  it("detects checksum rejection", () => {
    const result = classifyStorageError({
      name: "NotImplemented",
      message: "Header 'x-amz-checksum-crc32' with value not implemented"
    });
    expect(result.code).toBe("storage_checksum_rejected");
  });
});

describe("classifyOpenRouterError", () => {
  it("detects invalid api key", () => {
    const result = classifyOpenRouterError({
      status: 401,
      code: "invalid_api_key",
      message: "Incorrect API key provided"
    });
    expect(result.code).toBe("openrouter_auth_failed");
  });

  it("does not call billing exhaustion a soft rate limit", () => {
    const result = classifyOpenRouterError({
      status: 402,
      code: "insufficient_credits",
      message: "You exceeded your current quota"
    });
    expect(result.code).toBe("openrouter_quota_exhausted");
    expect(result.message.toLowerCase()).toContain("credit");
  });

  it("keeps true rate limits distinct", () => {
    const result = classifyOpenRouterError({
      status: 429,
      code: "rate_limit_exceeded",
      message: "Rate limit reached"
    });
    expect(result.code).toBe("openrouter_rate_limited");
  });
});
