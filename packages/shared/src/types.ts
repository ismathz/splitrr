export type BillSessionStatus =
  | "uploaded"
  | "parsed"
  | "assigning"
  | "confirmed"
  | "settled";

export interface ParsedBillItem {
  name: string;
  qty: number;
  unitPriceCents: number;
  totalPriceCents: number;
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
  rawText: string;
}

export interface BillSummary {
  billId: string;
  groupId: string;
  title: string;
  status: BillSessionStatus;
  createdAt: string;
}
