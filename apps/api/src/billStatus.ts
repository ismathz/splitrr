import type { BillSessionStatus } from "@splitbot/shared";

/**
 * Derive bill session status from the honor-system payment checklist.
 * Open bills with members are `pending`; all paid → `completed`.
 */
export function statusFromPaymentChecklist(input: {
  memberNames: string[];
  paidByName: Map<string, boolean> | Record<string, boolean>;
  /** Current status — `draft` stays draft when there are no members yet. */
  currentStatus?: string | null;
}): BillSessionStatus {
  const names = input.memberNames
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length === 0) {
    return input.currentStatus === "completed" ||
      input.currentStatus === "settled"
      ? "completed"
      : input.currentStatus === "pending" ||
          input.currentStatus === "active"
        ? "pending"
        : "draft";
  }

  const paidLookup =
    input.paidByName instanceof Map
      ? input.paidByName
      : new Map(Object.entries(input.paidByName));

  const allPaid = names.every((name) => paidLookup.get(name) === true);
  return allPaid ? "completed" : "pending";
}

/** Normalize legacy status strings stored before pending/completed rename. */
export function normalizeBillSessionStatus(
  status: string | null | undefined
): BillSessionStatus {
  if (status === "active") return "pending";
  if (status === "settled") return "completed";
  if (status === "pending" || status === "completed" || status === "draft") {
    return status;
  }
  return "draft";
}

/** When a bill is shared/opened with members, promote draft → pending. */
export function statusAfterOpenWithMembers(input: {
  currentStatus: string | null | undefined;
  memberCount: number;
}): BillSessionStatus {
  const current = normalizeBillSessionStatus(input.currentStatus);
  if (current === "completed") return "completed";
  if (input.memberCount > 0) return "pending";
  return current;
}
