import { describe, expect, it } from "bun:test";
import { allocateCentsByWeight } from "./splitter";

describe("allocateCentsByWeight", () => {
  it("allocates full amount with deterministic rounding", () => {
    const out = allocateCentsByWeight({
      itemTotalCents: 100,
      members: [
        { userId: 1, weight: 1 },
        { userId: 2, weight: 1 },
        { userId: 3, weight: 1 }
      ]
    });

    const sum = Array.from(out.values()).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
});
