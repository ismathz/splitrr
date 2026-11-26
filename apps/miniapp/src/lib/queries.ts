import { queryOptions, type QueryClient } from "@tanstack/react-query";

import type { BillDetails, Item } from "@/app/billTypes";
import {
  getBillDetails,
  getBillPaymentStatus,
  getGroupHistoryByTelegramChatId,
  getGroupRosterByTelegramChatId,
  GroupRosterRequestError,
  type ApiBillDetails,
  type ApiBillHistoryEntry,
  type ApiBillPaymentStatusMember,
} from "@/lib/splitbotApi";

/**
 * Cache layout. `history` holds `BillDetails[]` with `items: []`; `bill` holds
 * the full bill. Payment status nests under its bill so one prefix addresses both.
 */
export const queryKeys = {
  historyAll: ["history"] as const,
  history: (telegramChatId: string) => ["history", telegramChatId] as const,
  bill: (billId: string) => ["bill", billId] as const,
  paymentStatus: (billId: string) =>
    ["bill", billId, "payment-status"] as const,
  roster: (telegramChatId: string) => ["roster", telegramChatId] as const,
};

export type PaymentStatusData = { members: ApiBillPaymentStatusMember[] };

export function uniqueMembersInOrder(items: Item[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const item of items) {
    for (const name of item.assignees) {
      if (!seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
  }
  return ordered;
}

export function mapApiBillToDetails(fetched: ApiBillDetails): BillDetails {
  const items = fetched.items.map((item) => ({
    ...item,
    assignees: item.assignees ?? [],
  }));
  const membersFromApi = (fetched.members ?? [])
    .map((m) => m.trim())
    .filter(Boolean);
  const members =
    membersFromApi.length > 0 ? membersFromApi : uniqueMembersInOrder(items);
  return {
    ...fetched,
    members,
    memberProfiles: fetched.memberProfiles ?? [],
    items,
    charges: fetched.charges ?? [],
  };
}

export function mapHistoryEntry(entry: ApiBillHistoryEntry): BillDetails {
  return {
    ...entry,
    place: entry.place ?? null,
    members: entry.members ?? [],
    items: [],
  };
}

export function historyQueryOptions(
  base: string,
  telegramChatId: string | undefined,
) {
  return queryOptions({
    queryKey: queryKeys.history(telegramChatId ?? ""),
    queryFn: async () => {
      const { bills } = await getGroupHistoryByTelegramChatId(
        base,
        telegramChatId!,
      );
      return bills.map(mapHistoryEntry);
    },
    enabled: Boolean(base && telegramChatId),
  });
}

export function billQueryOptions(base: string, billId: string) {
  return queryOptions({
    queryKey: queryKeys.bill(billId),
    queryFn: async () =>
      mapApiBillToDetails(await getBillDetails(base, billId)),
    enabled: Boolean(base),
  });
}

export function paymentStatusQueryOptions(base: string, billId: string) {
  return queryOptions({
    queryKey: queryKeys.paymentStatus(billId),
    queryFn: () => getBillPaymentStatus(base, billId),
    enabled: Boolean(base),
  });
}

export function rosterQueryOptions(
  base: string,
  telegramChatId: string | undefined,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: queryKeys.roster(telegramChatId ?? ""),
    queryFn: () => getGroupRosterByTelegramChatId(base, telegramChatId!),
    enabled: enabled && Boolean(base && telegramChatId),
    staleTime: 5 * 60_000,
    // Auth failures will not fix themselves on retry.
    retry: (count, err) =>
      !(
        err instanceof GroupRosterRequestError &&
        (err.status === 401 || err.status === 403)
      ) && count < 1,
  });
}

/** Seed for the details screen while the full bill loads (items are empty). */
export function findBillInHistoryCache(
  qc: QueryClient,
  billId: string,
): BillDetails | undefined {
  for (const [, bills] of qc.getQueriesData<BillDetails[]>({
    queryKey: queryKeys.historyAll,
  })) {
    const hit = bills?.find((b) => b.id === billId);
    if (hit) return hit;
  }
  return undefined;
}

/** Apply `patch` to the cached bill and to its row in every history list. */
export function patchBillCaches(
  qc: QueryClient,
  billId: string,
  patch: (bill: BillDetails) => BillDetails,
): void {
  qc.setQueryData<BillDetails>(queryKeys.bill(billId), (old) =>
    old ? patch(old) : old,
  );
  qc.setQueriesData<BillDetails[]>(
    { queryKey: queryKeys.historyAll },
    (old) => old?.map((b) => (b.id === billId ? patch(b) : b)),
  );
}

export function removeBillFromHistoryCaches(
  qc: QueryClient,
  billId: string,
): void {
  qc.setQueriesData<BillDetails[]>(
    { queryKey: queryKeys.historyAll },
    (old) => old?.filter((b) => b.id !== billId),
  );
}

/** Return a copy of `data` with `name` marked paid/unpaid (adds the member if absent). */
export function withPaidToggle(
  data: PaymentStatusData | undefined,
  name: string,
  paid: boolean,
): PaymentStatusData {
  const members = data?.members ?? [];
  const exists = members.some((m) => m.name.trim() === name);
  return {
    members: exists
      ? members.map((m) => (m.name.trim() === name ? { ...m, paid } : m))
      : [...members, { name, paid }],
  };
}

export function paidNamesFrom(data: PaymentStatusData | undefined): Set<string> {
  const out = new Set<string>();
  for (const m of data?.members ?? []) {
    const name = m.name.trim();
    if (name && m.paid) out.add(name);
  }
  return out;
}

/** Toggle one member's paid flag in the cache and re-derive bill status from it. */
export function applyPaidToggleToCaches(
  qc: QueryClient,
  billId: string,
  name: string,
  paid: boolean,
  membersOrdered: string[],
): void {
  const key = queryKeys.paymentStatus(billId);
  const next = withPaidToggle(
    qc.getQueryData<PaymentStatusData>(key),
    name,
    paid,
  );
  qc.setQueryData<PaymentStatusData>(key, next);
  const paidNames = paidNamesFrom(next);
  const allPaid =
    membersOrdered.length > 0 && membersOrdered.every((m) => paidNames.has(m));
  patchBillCaches(qc, billId, (b) => ({
    ...b,
    status: allPaid ? "completed" : "pending",
    settled: allPaid,
  }));
}

/** Mark queries stale and refetch the active ones; await to avoid showing stale data. */
export function invalidateBillData(
  qc: QueryClient,
  billId: string,
): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.bill(billId) }),
    qc.invalidateQueries({ queryKey: queryKeys.historyAll }),
  ]).then(() => undefined);
}