import { describe, expect, it } from "bun:test";
import {
  applyChargesProportionally,
  chargesTotalCents,
  itemSharesByMember,
} from "./billShares";

function sumShares(map: Map<string, number>): number {
  let sum = 0;
  for (const v of map.values()) sum += v;
  return sum;
}

describe("billShares", () => {
  it("splits items then layers charges proportionally", () => {
    const shares = itemSharesByMember([
      { totalPriceCents: 1000, assignees: ["Alice", "Bob"] },
      { totalPriceCents: 500, assignees: ["Alice"] },
    ]);
    expect(shares.get("Alice")).toBe(1000); // 500 + 500
    expect(shares.get("Bob")).toBe(500);

    const withTax = applyChargesProportionally(shares, 150);
    // Alice weight 1000, Bob 500 → Alice 100, Bob 50
    expect(withTax.get("Alice")).toBe(1100);
    expect(withTax.get("Bob")).toBe(550);
    expect(chargesTotalCents([{ amountCents: 100 }, { amountCents: 50 }])).toBe(
      150,
    );
  });

  it("regression: 3×40.00 items + charges → 142.55 fair shares", () => {
    const shares = itemSharesByMember([
      { totalPriceCents: 4000, assignees: ["A"] },
      { totalPriceCents: 4000, assignees: ["B"] },
      { totalPriceCents: 4000, assignees: ["C"] },
    ]);
    expect(sumShares(shares)).toBe(12000);

    const withCharges = applyChargesProportionally(shares, 2255);
    expect(withCharges.get("A")).toBe(4752);
    expect(withCharges.get("B")).toBe(4752);
    expect(withCharges.get("C")).toBe(4751);
    expect(sumShares(withCharges)).toBe(14255);
  });

  it("distributes odd item totals across co-assignees", () => {
    const shares = itemSharesByMember([
      { totalPriceCents: 100, assignees: ["A", "B", "C"] },
    ]);
    expect(shares.get("A")).toBe(34);
    expect(shares.get("B")).toBe(33);
    expect(shares.get("C")).toBe(33);
    expect(sumShares(shares)).toBe(100);
  });

  it("always keeps sum(shares) == items + charges", () => {
    const shares = itemSharesByMember([
      { totalPriceCents: 3333, assignees: ["A", "B"] },
      { totalPriceCents: 1777, assignees: ["B", "C", "D"] },
      { totalPriceCents: 999, assignees: ["A"] },
    ]);
    const charges = 881;
    const withCharges = applyChargesProportionally(shares, charges);
    expect(sumShares(withCharges)).toBe(sumShares(shares) + charges);
  });
});
