import { describe, expect, it } from "bun:test";
import {
  sanitizeOptionalUserText,
  sanitizeUserText,
  TEXT_LIMITS,
} from "./sanitizeText";

describe("sanitizeUserText", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeUserText("  Dinner\n\tat  Ada's  ", 80)).toBe(
      "Dinner at Ada's",
    );
  });

  it("strips control, bidi, and zero-width characters", () => {
    expect(
      sanitizeUserText("Hi\u0000there\u202Etxet\u200B!", TEXT_LIMITS.billTitle),
    ).toBe("Hi theretxet!");
  });

  it("enforces max length", () => {
    expect(sanitizeUserText("abcdefghij", 5)).toBe("abcde");
  });

  it("returns empty for non-strings and blank input", () => {
    expect(sanitizeUserText(null, 80)).toBe("");
    expect(sanitizeUserText(12, 80)).toBe("");
    expect(sanitizeUserText("   \n\t  ", 80)).toBe("");
    expect(sanitizeUserText("ok", 0)).toBe("");
  });

  it("preserves @handles used as placeholders", () => {
    expect(sanitizeUserText("@alice_bob", TEXT_LIMITS.memberName)).toBe(
      "@alice_bob",
    );
  });
});

describe("sanitizeOptionalUserText", () => {
  it("maps empty to null", () => {
    expect(sanitizeOptionalUserText("  ", 80)).toBeNull();
    expect(sanitizeOptionalUserText("Cafe", 80)).toBe("Cafe");
  });
});
