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

export type BillMemberProfile = {
  name: string;
  photoUrl?: string | null;
  tgUserId?: number | null;
};

/** Persisted tax / service / custom charge on a bill. */
export type BillCharge = {
  id?: string;
  chargeType: string;
  amountCents: number;
  label?: string | null;
  ratePct?: number | null;
};

export type BillDetails = {
  id: string;
  title: string;
  status: "draft" | "pending" | "completed";
  /** ISO 4217 code. */
  currency: string;
  /** ISO date YYYY-MM-DD — when the meal / bill happened. */
  billDate: string;
  /** Venue or place (e.g. restaurant). */
  place: string | null;
  /** False until everyone has settled up. */
  settled: boolean;
  /** Bill participants persisted independently of item assignees. */
  members?: string[];
  /** Optional roster photos / Telegram ids for avatars on details. */
  memberProfiles?: BillMemberProfile[];
  items: Item[];
  /** Service / tax / tip / custom adjustments. */
  charges?: BillCharge[];
};
