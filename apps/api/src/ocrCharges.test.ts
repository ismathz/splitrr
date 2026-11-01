import { describe, expect, it } from "bun:test";
import {
  inferOcrCharges,
  inferRatePctFromAmount,
  isDiscountLineName,
  isServiceChargeLineName,
  isTaxLineName
} from "./ocrCharges";
import type { ParsedReceipt } from "@splitbot/shared";

describe("line name classifiers", () => {
  it("detects service charge labels", () => {
    expect(isServiceChargeLineName("Service Charge 10%")).toBe(true);
    expect(isServiceChargeLineName("Svc Chg")).toBe(true);
    expect(isServiceChargeLineName("Fried Rice")).toBe(false);
  });

  it("detects tax labels", () => {
    expect(isTaxLineName("GST 8%")).toBe(true);
    expect(isTaxLineName("TGST")).toBe(true);
    expect(isTaxLineName("Coffee")).toBe(false);
  });

  it("detects discount labels", () => {
    expect(isDiscountLineName("Staff Discount")).toBe(true);
    expect(isDiscountLineName("Promo")).toBe(true);
    expect(isDiscountLineName("Noodles")).toBe(false);
  });
});

describe("inferRatePctFromAmount", () => {
  it("infers clean Maldives rates", () => {
    expect(inferRatePctFromAmount(1000, 10000)).toBe(10);
    expect(inferRatePctFromAmount(880, 11000)).toBe(8);
  });

  it("returns null for missing base/amount", () => {
    expect(inferRatePctFromAmount(0, 100)).toBeNull();
    expect(inferRatePctFromAmount(10, 0)).toBeNull();
  });
});

describe("inferOcrCharges", () => {
  const base: ParsedReceipt = {
    currency: "MVR",
    rawText: "receipt",
    items: []
  };

  it("does not invent service charge or tax", () => {
    const result = inferOcrCharges({
      ...base,
      items: [
        {
          name: "Pasta",
          qty: 1,
          unitPriceCents: 5000,
          totalPriceCents: 5000,
          confidence: 0.9
        }
      ]
    });
    expect(result.serviceChargeCents).toBeUndefined();
    expect(result.taxCents).toBeUndefined();
    expect(result.discountAdjustments).toEqual([]);
    expect(result.items).toHaveLength(1);
  });

  it("pulls SC/tax lines out of items and infers rates", () => {
    const result = inferOcrCharges({
      ...base,
      items: [
        {
          name: "Burger",
          qty: 1,
          unitPriceCents: 10000,
          totalPriceCents: 10000,
          confidence: 0.95
        },
        {
          name: "Service Charge",
          qty: 1,
          unitPriceCents: 1000,
          totalPriceCents: 1000,
          confidence: 0.9
        },
        {
          name: "GST",
          qty: 1,
          unitPriceCents: 880,
          totalPriceCents: 880,
          confidence: 0.9
        }
      ]
    });
    expect(result.items.map((i) => i.name)).toEqual(["Burger"]);
    expect(result.serviceChargeCents).toBe(1000);
    expect(result.taxCents).toBe(880);
    expect(result.serviceChargeRatePct).toBe(10);
    expect(result.taxRatePct).toBe(8);
  });

  it("prefers top-level cents and only keeps discounts from the bill", () => {
    const result = inferOcrCharges({
      ...base,
      serviceChargeCents: 500,
      taxCents: 200,
      items: [
        {
          name: "Tea",
          qty: 1,
          unitPriceCents: 2000,
          totalPriceCents: 2000,
          confidence: 0.9
        },
        {
          name: "Happy hour discount",
          qty: 1,
          unitPriceCents: -300,
          totalPriceCents: -300,
          confidence: 0.85
        }
      ]
    });
    expect(result.serviceChargeCents).toBe(500);
    expect(result.taxCents).toBe(200);
    expect(result.serviceChargeRatePct).toBe(25);
    expect(result.discountAdjustments).toEqual([
      {
        name: "Happy hour discount",
        amountCents: -300,
        confidence: 0.85
      }
    ]);
  });
});
