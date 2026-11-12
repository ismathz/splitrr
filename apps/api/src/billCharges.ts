import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

export type BillChargeInput = {
  id?: string;
  chargeType: string;
  amountCents: number;
  label?: string | null;
  ratePct?: number | null;
};

export type BillChargeRow = {
  id: string;
  chargeType: string;
  amountCents: number;
  label: string | null;
  ratePct: number | null;
};

const ALLOWED_TYPES = new Set([
  "service",
  "tax",
  "tip",
  "discount",
  "custom",
  "other",
]);

export function normalizeChargeType(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (ALLOWED_TYPES.has(t)) return t;
  return "custom";
}

/** Replace all charges for a bill (PATCH save). */
export function replaceBillCharges(
  db: Database,
  billId: string,
  charges: BillChargeInput[],
): void {
  db.query("DELETE FROM charges WHERE bill_session_id = ?1").run(billId);
  const insert = db.query(
    `INSERT INTO charges (id, bill_session_id, charge_type, amount_cents, label, rate_pct)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  );

  for (const raw of charges) {
    const amount = Math.round(Number(raw.amountCents));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const chargeType = normalizeChargeType(String(raw.chargeType ?? "custom"));
    const label =
      typeof raw.label === "string" && raw.label.trim()
        ? raw.label.trim().slice(0, 120)
        : null;
    const rateRaw = raw.ratePct;
    const ratePct =
      typeof rateRaw === "number" && Number.isFinite(rateRaw) && rateRaw > 0
        ? rateRaw
        : null;
    insert.run(
      raw.id?.trim() || randomUUID(),
      billId,
      chargeType,
      amount,
      label,
      ratePct,
    );
  }
}

export function loadBillCharges(db: Database, billId: string): BillChargeRow[] {
  const rows = db
    .query(
      `SELECT id,
              charge_type AS chargeType,
              amount_cents AS amountCents,
              label AS label,
              rate_pct AS ratePct
       FROM charges
       WHERE bill_session_id = ?1
       ORDER BY created_at ASC`,
    )
    .all(billId) as Array<{
    id: string;
    chargeType: string;
    amountCents: number;
    label: string | null;
    ratePct: number | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    chargeType: r.chargeType,
    amountCents: r.amountCents,
    label: r.label,
    ratePct: r.ratePct == null ? null : Number(r.ratePct),
  }));
}
