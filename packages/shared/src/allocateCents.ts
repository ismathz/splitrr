/** Member with a non-negative weight used for proportional allocation. */
export type WeightedMember<T> = {
  id: T;
  weight: number;
};

function truncDiv(numerator: number, denominator: number): number {
  return Math.trunc(numerator / denominator);
}

/**
 * Allocate `totalCents` among members by weight using the largest-remainder
 * (Hamilton) method in integer minor units (laari/cents).
 *
 * - Shares always sum exactly to `totalCents`
 * - No share differs from the exact proportional amount by more than 1
 * - Ties break by stable input order (earlier members get remainder units first)
 */
export function allocateCentsByWeight<T>(
  totalCents: number,
  members: ReadonlyArray<WeightedMember<T>>,
): Map<T, number> {
  const result = new Map<T, number>();
  if (members.length === 0) return result;

  const sanitized = members.map((m) => ({
    id: m.id,
    weight: Number.isFinite(m.weight) ? Math.max(m.weight, 0) : 0,
  }));
  let totalWeight = sanitized.reduce((sum, m) => sum + m.weight, 0);
  const weighted =
    totalWeight > 0 ? sanitized : sanitized.map((m) => ({ ...m, weight: 1 }));
  if (totalWeight <= 0) {
    totalWeight = weighted.length;
  }
  if (totalWeight <= 0) return result;

  const rows = weighted.map((m, index) => {
    const product = totalCents * m.weight;
    const quotient = truncDiv(product, totalWeight);
    const rem = product - quotient * totalWeight;
    return { id: m.id, quotient, rem, index };
  });

  let allocated = 0;
  for (const row of rows) {
    allocated += row.quotient;
    result.set(row.id, row.quotient);
  }

  let delta = totalCents - allocated;
  if (delta === 0) return result;

  const ranked = [...rows].sort((a, b) => {
    if (delta > 0) {
      if (b.rem !== a.rem) return b.rem - a.rem;
    } else if (a.rem !== b.rem) {
      return a.rem - b.rem;
    }
    return a.index - b.index;
  });

  const step = delta > 0 ? 1 : -1;
  const count = Math.abs(delta);
  for (let i = 0; i < count; i += 1) {
    const row = ranked[i % ranked.length]!;
    result.set(row.id, (result.get(row.id) ?? 0) + step);
  }

  return result;
}

/** Equal-weight split of `totalCents` across `ids` (largest-remainder). */
export function allocateCentsEqual<T>(
  totalCents: number,
  ids: ReadonlyArray<T>,
): Map<T, number> {
  return allocateCentsByWeight(
    totalCents,
    ids.map((id) => ({ id, weight: 1 })),
  );
}
