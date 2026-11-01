import { describe, expect, it } from "bun:test";
import { toOcrImageDataUrl } from "./ocr";

describe("toOcrImageDataUrl", () => {
  it("builds a jpeg data URL", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = toOcrImageDataUrl(bytes, "image/jpeg");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    }
  });

  it("rejects HEIC", () => {
    const result = toOcrImageDataUrl(new Uint8Array([1]), "image/heic");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.toLowerCase()).toContain("heic");
  });
});
