export type BillSessionStatus =
  | "draft"
  | "active"
  | "settled";

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
  active: {
    label: "Open / Active",
    description:
      "Bill is shared and waiting for payments until all participants have paid their share.",
    visibleToParticipants: true,
    editableFreely: false,
  },
  settled: {
    label: "Settled (Fully Paid)",
    description: "Everyone has paid their share and the bill is complete.",
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
  taxCents?: number;
  tipCents?: number;
  totalCents?: number;
  items: ParsedBillItem[];
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
