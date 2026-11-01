import { describe, expect, it } from "bun:test";
import { classifyOpenAiError } from "./pipelineErrors";
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

describe("classifyOpenAiError", () => {
  it("detects invalid api key", () => {
    const result = classifyOpenAiError({
      status: 401,
      code: "invalid_api_key",
      message: "Incorrect API key provided"
    });
    expect(result.code).toBe("openai_auth_failed");
  });
});
