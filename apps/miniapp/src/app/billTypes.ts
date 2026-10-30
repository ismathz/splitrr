export type Item = {
  id: string;
  name: string;
  totalPriceCents: number;
  assignees: string[];
  /** Set when parsed by AI; omit for manually added items (UI uses keyword map). */
  emoji?: string;
};

/** Format ISO date YYYY-MM-DD for display (local calendar day). */
export function formatBillDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type BillDetails = {
  id: string;
  title: string;
  status: "draft" | "active" | "settled";
  /** ISO 4217 code. */
  currency: string;
  /** ISO date YYYY-MM-DD — when the meal / bill happened. */
  billDate: string;
  /** Venue or place (e.g. restaurant). */
  place: string | null;
  /** False until everyone has settled up. */
  settled: boolean;
  items: Item[];
};
