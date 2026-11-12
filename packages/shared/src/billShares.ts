/** Line item used for honor-system share math. */
export type ShareItem = {
  totalPriceCents: number;
  assignees: string[];
};

/**
 * Per-member item shares (floor split). Matches Mini App details breakdown.
 */
export function itemSharesByMember(items: ShareItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const n = Math.max(item.assignees.length, 1);
    const share = Math.floor(item.totalPriceCents / n);
    for (const member of item.assignees) {
      const name = member.trim();
      if (!name) continue;
      map.set(name, (map.get(name) ?? 0) + share);
    }
  }
  return map;
}

/**
 * Split charges among members proportional to their current item shares
 * (same approach as settlement compute). Mutates a copy; returns new map.
 */
export function applyChargesProportionally(
  itemShares: Map<string, number>,
  chargesTotalCents: number,
): Map<string, number> {
  const next = new Map(itemShares);
  if (chargesTotalCents === 0 || next.size === 0) return next;

  const members = [...next.entries()].map(([name, share]) => ({
    name,
    weight: Math.max(share, 0),
  }));
  const weightSum = members.reduce((s, m) => s + m.weight, 0);
  const weights =
    weightSum > 0 ? members : members.map((m) => ({ ...m, weight: 1 }));
  const totalWeight = weights.reduce((s, m) => s + m.weight, 0);
  if (totalWeight <= 0) return next;

  let allocated = 0;
  weights.forEach((m, index) => {
    const isLast = index === weights.length - 1;
    const portion = isLast
      ? chargesTotalCents - allocated
      : Math.floor((chargesTotalCents * m.weight) / totalWeight);
    allocated += portion;
    next.set(m.name, (next.get(m.name) ?? 0) + portion);
  });
  return next;
}

export function chargesTotalCents(
  charges: Array<{ amountCents: number }>,
): number {
  return charges.reduce((s, c) => s + c.amountCents, 0);
}
