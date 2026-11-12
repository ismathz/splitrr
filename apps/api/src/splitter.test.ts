import { describe, expect, it } from "bun:test";
import { allocateCentsByWeight } from "./splitter";

describe("allocateCentsByWeight", () => {
  it("allocates full amount with deterministic rounding", () => {
    const out = allocateCentsByWeight({
      itemTotalCents: 100,
      members: [
        { userId: 1, weight: 1 },
        { userId: 2, weight: 1 },
        { userId: 3, weight: 1 },
      ],
    });

    const sum = Array.from(out.values()).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
    expect(out.get(1)).toBe(34);
    expect(out.get(2)).toBe(33);
    expect(out.get(3)).toBe(33);
  });

  it("regression: 142.55 across 3 equal members", () => {
    const out = allocateCentsByWeight({
      itemTotalCents: 14255,
      members: [
        { userId: 1, weight: 1 },
        { userId: 2, weight: 1 },
        { userId: 3, weight: 1 },
      ],
    });
    expect(out.get(1)).toBe(4752);
    expect(out.get(2)).toBe(4752);
    expect(out.get(3)).toBe(4751);
    expect([...out.values()].reduce((a, b) => a + b, 0)).toBe(14255);
  });
});
