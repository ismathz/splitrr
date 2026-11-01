import { describe, expect, it } from "bun:test";
import { sniffReceiptMime, validateReceiptFile } from "./receiptValidation";

describe("sniffReceiptMime", () => {
  it("uses declared type when present", () => {
    const f = new File([new Uint8Array([1, 2, 3])], "x.bin", {
      type: "image/png"
    });
    expect(sniffReceiptMime(f)).toBe("image/png");
  });

  it("falls back to extension when type empty", () => {
    const f = new File([new Uint8Array([1, 2, 3])], "shot.JPEG", { type: "" });
    expect(sniffReceiptMime(f)).toBe("image/jpeg");
  });

  it("defaults empty type + no ext to jpeg (Telegram camera)", () => {
    const f = new File([new Uint8Array([1, 2, 3])], "image", { type: "" });
    expect(sniffReceiptMime(f)).toBe("image/jpeg");
  });
});

describe("validateReceiptFile", () => {
  it("accepts sniffed jpeg", () => {
    const f = new File([new Uint8Array([1, 2, 3, 4])], "cam.jpg", { type: "" });
    const result = validateReceiptFile(f);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mime).toBe("image/jpeg");
  });
});
