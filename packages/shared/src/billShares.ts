import { allocateCentsByWeight, allocateCentsEqual } from "./allocateCents";

/** Line item used for honor-system share math. */
export type ShareItem = {
  totalPriceCents: number;
  assignees: string[];
};

/**
 * Per-member item shares using largest-remainder equal splits per line item.
 * Matches Mini App details breakdown and widget honor-system math.
 */
export function itemSharesByMember(items: ShareItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const assignees = item.assignees
      .map((member) => member.trim())
      .filter(Boolean);
    if (assignees.length === 0) continue;

    const parts = allocateCentsEqual(item.totalPriceCents, assignees);
    for (const [name, share] of parts) {
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
    id: name,
    weight: Math.max(share, 0),
  }));
  const allocation = allocateCentsByWeight(chargesTotalCents, members);
  for (const [name, portion] of allocation) {
    next.set(name, (next.get(name) ?? 0) + portion);
  }
  return next;
}

export function chargesTotalCents(
  charges: Array<{ amountCents: number }>,
): number {
  return charges.reduce((s, c) => s + c.amountCents, 0);
}
