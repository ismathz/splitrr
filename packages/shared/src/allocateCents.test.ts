import { describe, expect, it } from "bun:test";
import { allocateCentsByWeight, allocateCentsEqual } from "./allocateCents";

function sumValues(map: Map<unknown, number>): number {
  let sum = 0;
  for (const v of map.values()) sum += v;
  return sum;
}

describe("allocateCentsByWeight", () => {
  it("distributes 142.55/3 fairly (largest remainder)", () => {
    // 3 equal people, total MVR 142.55 → 47.52, 47.52, 47.51
    const out = allocateCentsEqual(14255, ["a", "b", "c"]);
    expect([...out.values()]).toEqual([4752, 4752, 4751]);
    expect(sumValues(out)).toBe(14255);
  });

  it("keeps even totals exact", () => {
    const out = allocateCentsEqual(900, ["a", "b", "c"]);
    expect([...out.values()]).toEqual([300, 300, 300]);
    expect(sumValues(out)).toBe(900);
  });

  it("handles 1-person bills", () => {
    const out = allocateCentsEqual(14255, ["solo"]);
    expect(out.get("solo")).toBe(14255);
    expect(sumValues(out)).toBe(14255);
  });

  it("handles many people without anyone more than 1 off", () => {
    const ids = Array.from({ length: 17 }, (_, i) => `p${i}`);
    const total = 10007;
    const out = allocateCentsEqual(total, ids);
    expect(sumValues(out)).toBe(total);
    const floor = Math.floor(total / ids.length);
    const ceil = floor + 1;
    for (const v of out.values()) {
      expect(v === floor || v === ceil).toBe(true);
    }
  });

  it("splits proportional charges with largest remainder", () => {
    // Items 40+40+40, charges 22.55 → each base 40; charge parts 7.52, 7.52, 7.51
    const out = allocateCentsByWeight(2255, [
      { id: "a", weight: 4000 },
      { id: "b", weight: 4000 },
      { id: "c", weight: 4000 },
    ]);
    expect([...out.values()]).toEqual([752, 752, 751]);
    expect(sumValues(out)).toBe(2255);
  });

  it("breaks remainder ties by stable member order", () => {
    const out = allocateCentsEqual(100, ["first", "second", "third"]);
    expect(out.get("first")).toBe(34);
    expect(out.get("second")).toBe(33);
    expect(out.get("third")).toBe(33);
    expect(sumValues(out)).toBe(100);
  });

  it("distributes negative charges (discounts) fairly", () => {
    const out = allocateCentsEqual(-100, ["a", "b", "c"]);
    expect([...out.values()]).toEqual([-34, -33, -33]);
    expect(sumValues(out)).toBe(-100);
  });

  it("falls back to equal weights when all weights are zero", () => {
    const out = allocateCentsByWeight(10, [
      { id: 1, weight: 0 },
      { id: 2, weight: 0 },
    ]);
    expect(out.get(1)).toBe(5);
    expect(out.get(2)).toBe(5);
    expect(sumValues(out)).toBe(10);
  });
});
