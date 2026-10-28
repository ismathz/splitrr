import { describe, expect, it } from "bun:test";
import { computeSettlementTransfers } from "./settlement";

describe("computeSettlementTransfers", () => {
  it("creates transfers when one person paid the merchant", () => {
    const transfers = computeSettlementTransfers({
      paidByUserId: 1,
      charges: [{ amountCents: 100 }], // tip
      items: [
        { itemId: "a", totalPriceCents: 1000, userId: 1, weight: 1 },
        { itemId: "a", totalPriceCents: 1000, userId: 2, weight: 1 },
        { itemId: "b", totalPriceCents: 400, userId: 2, weight: 1 }
      ]
    });

    // Item shares: user1=500, user2=500+400=900; tip 100 split 500:900 → ~36 / ~64
    // Net bill 1500; user1 paid → balances before simplify ≈
    // u1: 500+36-1500 = -964; u2: 900+64 = 964
    expect(transfers.length).toBe(1);
    expect(transfers[0]).toEqual({
      payerUserId: 2,
      payeeUserId: 1,
      amountCents: 964
    });
  });

  it("returns empty when nobody is assigned", () => {
    const transfers = computeSettlementTransfers({
      paidByUserId: 1,
      charges: [],
      items: [{ itemId: "a", totalPriceCents: 500, userId: null, weight: null }]
    });
    // paidBy credited -500, no debtors with positive share → empty
    expect(transfers).toEqual([]);
  });
});
