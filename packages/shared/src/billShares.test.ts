import { describe, expect, it } from "bun:test";
import {
  applyChargesProportionally,
  chargesTotalCents,
  itemSharesByMember,
} from "./billShares";

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
});
