import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { BillDetails } from "@/app/billTypes";
import {
  applyPaidToggleToCaches,
  invalidateBillData,
  patchBillCaches,
  queryKeys,
  removeBillFromHistoryCaches,
} from "@/lib/queries";
import {
  announceBillToGroup,
  deleteBill,
  updateBillDetails,
  updateBillPaymentStatus,
  updateMyPaymentDetails,
} from "@/lib/splitbotApi";

type UpdateBillBody = Parameters<typeof updateBillDetails>[2];

/** PATCH body that re-sends the whole bill with `over` applied. */
export function billUpdatePayload(
  bill: BillDetails,
  members: string[],
  over: { title?: string; paidByName?: string } = {},
): UpdateBillBody {
  return {
    title: over.title ?? bill.title,
    billDate: bill.billDate,
    place: bill.place,
    members,
    ...(over.paidByName !== undefined ? { paidByName: over.paidByName } : {}),
    items: bill.items.map((item) => ({
      id: item.id,
      name: item.name,
      totalPriceCents: item.totalPriceCents,
      assignees: item.assignees ?? [],
    })),
    charges: bill.charges ?? [],
  };
}

/**
 * Bill-details mutations. Each updates the cache first (so the UI is instant),
 * rolls back only what it changed on failure, and refetches when settled.
 * With no API base (offline demo) the cache update is the whole effect.
 */
export function useBillMutations(base: string, billId: string) {
  const qc = useQueryClient();

  const togglePaid = useMutation({
    mutationKey: ["togglePaid", billId],
    mutationFn: async (v: {
      name: string;
      paid: boolean;
      membersOrdered: string[];
    }) => {
      if (!base) return { ok: true as const, status: undefined };
      return updateBillPaymentStatus(base, billId, {
        name: v.name,
        paid: v.paid,
      });
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: queryKeys.bill(billId) });
      applyPaidToggleToCaches(qc, billId, v.name, v.paid, v.membersOrdered);
    },
    onError: (_e, v) => {
      applyPaidToggleToCaches(qc, billId, v.name, !v.paid, v.membersOrdered);
    },
    onSuccess: (result) => {
      if (!result.status) return;
      const status = result.status;
      patchBillCaches(qc, billId, (b) => ({
        ...b,
        status,
        settled: status === "completed",
      }));
    },
    onSettled: () => {
      // Refetch once the last in-flight toggle lands, so a refetch never
      // overwrites another toggle that is still pending.
      // Not returned: the checkbox must re-enable when the save lands, not after the refetch.
      if (qc.isMutating({ mutationKey: ["togglePaid", billId] }) === 1) {
        void invalidateBillData(qc, billId);
      }
    },
  });

  const selectPaidBy = useMutation({
    mutationKey: ["selectPaidBy", billId],
    mutationFn: async (v: {
      name: string;
      isSelf: boolean;
      payload: UpdateBillBody;
    }) => {
      if (!base) return;
      await updateBillDetails(base, billId, v.payload);
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: queryKeys.bill(billId) });
      const prev = qc.getQueryData<BillDetails>(queryKeys.bill(billId));
      patchBillCaches(qc, billId, (b) => ({
        ...b,
        paidByName: v.name,
        isCurrentUserPayer: v.isSelf,
        // The old payer's payment text must not show under the new payer;
        // the refetch in onSettled brings the new payer's own details.
        paymentDetails: null,
      }));
      return {
        paidByName: prev?.paidByName,
        isCurrentUserPayer: prev?.isCurrentUserPayer,
        paymentDetails: prev?.paymentDetails,
      };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      patchBillCaches(qc, billId, (b) => ({ ...b, ...ctx }));
    },
    // The new payer's payment details only come from the server.
    onSettled: () => invalidateBillData(qc, billId),
  });

  const saveTitle = useMutation({
    mutationKey: ["saveTitle", billId],
    mutationFn: async (v: { title: string; payload: UpdateBillBody }) => {
      if (!base) return;
      await updateBillDetails(base, billId, v.payload);
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: queryKeys.bill(billId) });
      const prev = qc.getQueryData<BillDetails>(queryKeys.bill(billId));
      patchBillCaches(qc, billId, (b) => ({ ...b, title: v.title }));
      return { title: prev?.title };
    },
    onError: (_e, _v, ctx) => {
      const title = ctx?.title;
      if (title === undefined) return;
      patchBillCaches(qc, billId, (b) => ({ ...b, title }));
    },
    onSettled: () => {
      void invalidateBillData(qc, billId);
    },
  });

  const announce = useMutation({
    mutationKey: ["announce", billId],
    mutationFn: () => announceBillToGroup(base, billId),
    onSuccess: () => {
      patchBillCaches(qc, billId, (b) =>
        b.status === "draft" ? { ...b, status: "pending", settled: false } : b,
      );
    },
  });

  const savePaymentDetails = useMutation({
    mutationKey: ["savePaymentDetails", billId],
    mutationFn: (paymentDetails: string | null) =>
      updateMyPaymentDetails(base, paymentDetails),
    onMutate: async (paymentDetails) => {
      await qc.cancelQueries({ queryKey: queryKeys.bill(billId) });
      const prev = qc.getQueryData<BillDetails>(queryKeys.bill(billId));
      patchBillCaches(qc, billId, (b) => ({ ...b, paymentDetails }));
      return { paymentDetails: prev?.paymentDetails };
    },
    onError: (_e, _v, ctx) => {
      if (!ctx) return;
      patchBillCaches(qc, billId, (b) => ({
        ...b,
        paymentDetails: ctx.paymentDetails,
      }));
    },
    onSuccess: (result) => {
      patchBillCaches(qc, billId, (b) => ({
        ...b,
        paymentDetails: result.paymentDetails,
      }));
    },
  });

  const remove = useMutation({
    mutationKey: ["deleteBill", billId],
    mutationFn: () => deleteBill(base, billId),
    onSuccess: () => removeBillFromHistoryCaches(qc, billId),
  });

  return { togglePaid, selectPaidBy, saveTitle, announce, savePaymentDetails, remove };
}
