import { allocateCentsByWeight } from "./splitter";

export interface SettlementItemRow {
  itemId: string;
  totalPriceCents: number;
  userId: number | null;
  weight: number | null;
}

export interface SettlementCharge {
  amountCents: number;
}

/**
 * Compute net balances (positive = owes, negative = is owed) then pairwise transfers.
 * Requires `paidByUserId` (who paid the merchant) so creditors exist.
 * Tax/tip/discount charges are split among participants proportional to item shares.
 */
export function computeSettlementTransfers(input: {
  items: SettlementItemRow[];
  charges: SettlementCharge[];
  paidByUserId: number;
}): Array<{ payerUserId: number; payeeUserId: number; amountCents: number }> {
  const balances = new Map<number, number>();
  const grouped = new Map<string, SettlementItemRow[]>();
  for (const row of input.items) {
    if (!grouped.has(row.itemId)) grouped.set(row.itemId, []);
    grouped.get(row.itemId)?.push(row);
  }

  let itemsTotal = 0;
  for (const rows of grouped.values()) {
    const total = rows[0]?.totalPriceCents ?? 0;
    itemsTotal += total;
    const members = rows
      .filter((r) => r.userId !== null)
      .map((r) => ({ userId: r.userId as number, weight: r.weight ?? 1 }));

    const allocation = allocateCentsByWeight({
      itemTotalCents: total,
      members
    });
    for (const [userId, owed] of allocation.entries()) {
      balances.set(userId, (balances.get(userId) ?? 0) + owed);
    }
  }

  const chargesTotal = input.charges.reduce((s, c) => s + c.amountCents, 0);
  if (chargesTotal !== 0 && balances.size > 0) {
    const members = [...balances.entries()].map(([userId, share]) => ({
      userId,
      weight: Math.max(share, 0)
    }));
    const weightSum = members.reduce((s, m) => s + m.weight, 0);
    const chargeMembers =
      weightSum > 0
        ? members
        : members.map((m) => ({ ...m, weight: 1 }));
    const chargeAlloc = allocateCentsByWeight({
      itemTotalCents: chargesTotal,
      members: chargeMembers
    });
    for (const [userId, owed] of chargeAlloc.entries()) {
      balances.set(userId, (balances.get(userId) ?? 0) + owed);
    }
  }

  const netBill = itemsTotal + chargesTotal;
  balances.set(
    input.paidByUserId,
    (balances.get(input.paidByUserId) ?? 0) - netBill
  );

  const debtors: Array<{ userId: number; amount: number }> = [];
  const creditors: Array<{ userId: number; amount: number }> = [];

  for (const [userId, amount] of balances) {
    if (amount > 0) debtors.push({ userId, amount });
    else if (amount < 0) creditors.push({ userId, amount: -amount });
  }

  const transfers: Array<{
    payerUserId: number;
    payeeUserId: number;
    amountCents: number;
  }> = [];

  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]!;
    const creditor = creditors[j]!;
    const transfer = Math.min(debtor.amount, creditor.amount);
    if (transfer > 0) {
      transfers.push({
        payerUserId: debtor.userId,
        payeeUserId: creditor.userId,
        amountCents: transfer
      });
    }
    debtor.amount -= transfer;
    creditor.amount -= transfer;
    if (debtor.amount === 0) i += 1;
    if (creditor.amount === 0) j += 1;
  }

  return transfers;
}
