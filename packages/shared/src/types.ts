export type BillSessionStatus =
  | "draft"
  | "pending"
  | "completed";

export interface BillSessionStatusMeta {
  label: string;
  description: string;
  visibleToParticipants: boolean;
  editableFreely: boolean;
}

export const BILL_SESSION_STATUS_META: Record<
  BillSessionStatus,
  BillSessionStatusMeta
> = {
  draft: {
    label: "Draft",
    description: "Bill is being created and is not visible to participants yet.",
    visibleToParticipants: false,
    editableFreely: true,
  },
  pending: {
    label: "Pending",
    description:
      "Bill is open with members and waiting until everyone has marked their share paid.",
    visibleToParticipants: true,
    editableFreely: false,
  },
  completed: {
    label: "Completed",
    description: "Everyone has marked their share paid and the bill is complete.",
    visibleToParticipants: true,
    editableFreely: false,
  },
};

export interface ParsedBillItem {
  name: string;
  qty: number;
  unitPriceCents: number;
  totalPriceCents: number;
  confidence: number;
}

export interface ParsedReceiptAdjustment {
  name: string;
  amountCents: number;
  confidence: number;
}

export interface ParsedReceipt {
  merchantName?: string;
  currency: string;
  subtotalCents?: number;
  /** Service charge amount when present on the receipt (cents). */
  serviceChargeCents?: number;
  taxCents?: number;
  tipCents?: number;
  totalCents?: number;
  /**
   * Inferred service-charge % of food subtotal when `serviceChargeCents` is set.
   * Null when the amount is present but the rate cannot be inferred.
   */
  serviceChargeRatePct?: number | null;
  /**
   * Inferred tax % of (food subtotal + service charge when present).
   * Null when tax is present but the rate cannot be inferred.
   */
  taxRatePct?: number | null;
  items: ParsedBillItem[];
  /** Discounts only when they appear on the bill (negative lines / discount labels). */
  discountAdjustments?: ParsedReceiptAdjustment[];
  rawText: string;
}

export interface BillSummary {
  billId: string;
  groupId: string;
  title: string;
  status: BillSessionStatus;
  /** ISO 4217 currency code (e.g. USD, MVR). */
  currency: string;
  /** When the bill / meal happened (ISO date YYYY-MM-DD). */
  billDate: string;
  /** Venue or place name (e.g. restaurant). */
  place: string | null;
  createdAt: string;
}
