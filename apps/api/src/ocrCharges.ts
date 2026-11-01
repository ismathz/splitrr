import type {
  ParsedBillItem,
  ParsedReceipt,
  ParsedReceiptAdjustment
} from "@splitbot/shared";

const SERVICE_CHARGE_NAME_RE =
  /\b(service\s*charge|service\s*fee|svc\.?\s*chg|serv\.?\s*chg|gratuity|\bsc\b)\b/i;
const TAX_NAME_RE = /\b(gst|tgst|vat|sales\s*tax|tax)\b/i;
const DISCOUNT_NAME_RE =
  /\b(discount|promo|promotion|coupon|rebate|less\s+discount|comp)\b/i;

export function isServiceChargeLineName(name: string): boolean {
  return SERVICE_CHARGE_NAME_RE.test(name.trim());
}

export function isTaxLineName(name: string): boolean {
  return TAX_NAME_RE.test(name.trim());
}

export function isDiscountLineName(name: string): boolean {
  return DISCOUNT_NAME_RE.test(name.trim());
}

/** Round a percentage to two decimals (e.g. 8.00, 10.25). */
export function roundRatePct(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(rate * 100) / 100;
}

/**
 * Infer a percentage rate from an amount and a base.
 * Returns null when the amount/base cannot produce a meaningful rate.
 */
export function inferRatePctFromAmount(
  amountCents: number,
  baseCents: number
): number | null {
  if (
    !Number.isFinite(amountCents) ||
    !Number.isFinite(baseCents) ||
    amountCents <= 0 ||
    baseCents <= 0
  ) {
    return null;
  }
  return roundRatePct((amountCents / baseCents) * 100);
}

export type OcrChargesInference = {
  items: ParsedBillItem[];
  serviceChargeCents?: number;
  taxCents?: number;
  tipCents?: number;
  /** Inferred SC % of item subtotal when SC is present. */
  serviceChargeRatePct?: number | null;
  /**
   * Inferred tax % of (item subtotal + service charge when SC present),
   * matching typical GST-on-(food+SC) receipts.
   */
  taxRatePct?: number | null;
  discountAdjustments: ParsedReceiptAdjustment[];
};

/**
 * Pull service charge / tax / discount out of OCR line items when the model
 * put them there, prefer top-level cents fields, and infer % rates for the Mini App.
 * Does not invent charges — only keeps what appears on the bill.
 */
export function inferOcrCharges(parsed: ParsedReceipt): OcrChargesInference {
  const normalizedItems = parsed.items
    .map((item) => ({
      ...item,
      name: item.name.trim()
    }))
    .filter((item) => item.name.length > 0);

  const discountAdjustments: ParsedReceiptAdjustment[] = [];
  let serviceChargeFromItems = 0;
  let taxFromItems = 0;
  const foodItems: ParsedBillItem[] = [];

  for (const item of normalizedItems) {
    const isNegative =
      item.totalPriceCents < 0 || item.unitPriceCents < 0;
    const absTotal =
      item.totalPriceCents !== 0
        ? Math.abs(item.totalPriceCents)
        : Math.abs(Math.round(item.unitPriceCents * item.qty));

    if (isNegative || isDiscountLineName(item.name)) {
      const derived =
        item.totalPriceCents !== 0
          ? item.totalPriceCents
          : Math.round(item.unitPriceCents * item.qty);
      discountAdjustments.push({
        name: item.name,
        amountCents: derived < 0 ? derived : -Math.abs(derived || absTotal),
        confidence: item.confidence
      });
      continue;
    }

    if (isServiceChargeLineName(item.name) && item.totalPriceCents > 0) {
      serviceChargeFromItems += item.totalPriceCents;
      continue;
    }

    if (isTaxLineName(item.name) && item.totalPriceCents > 0) {
      taxFromItems += item.totalPriceCents;
      continue;
    }

    if (
      Number.isFinite(item.qty) &&
      item.qty > 0 &&
      item.unitPriceCents >= 0 &&
      item.totalPriceCents > 0
    ) {
      foodItems.push(item);
    }
  }

  const topService = parsed.serviceChargeCents;
  const topTax = parsed.taxCents;
  const tipCents =
    typeof parsed.tipCents === "number" && parsed.tipCents > 0
      ? parsed.tipCents
      : undefined;

  // Prefer explicit top-level OCR fields; fall back to extracted line items.
  const serviceChargeCents =
    typeof topService === "number" && topService > 0
      ? topService
      : serviceChargeFromItems > 0
        ? serviceChargeFromItems
        : undefined;

  const taxCents =
    typeof topTax === "number" && topTax > 0
      ? topTax
      : taxFromItems > 0
        ? taxFromItems
        : undefined;

  const itemsSubtotalCents = foodItems.reduce(
    (sum, item) => sum + item.totalPriceCents,
    0
  );

  const serviceChargeRatePct =
    serviceChargeCents != null
      ? inferRatePctFromAmount(serviceChargeCents, itemsSubtotalCents)
      : null;

  const taxBaseCents =
    itemsSubtotalCents + (serviceChargeCents != null ? serviceChargeCents : 0);
  const taxRatePct =
    taxCents != null
      ? inferRatePctFromAmount(taxCents, taxBaseCents)
      : null;

  return {
    items: foodItems,
    serviceChargeCents,
    taxCents,
    tipCents,
    serviceChargeRatePct:
      serviceChargeCents != null ? serviceChargeRatePct : undefined,
    taxRatePct: taxCents != null ? taxRatePct : undefined,
    discountAdjustments
  };
}
