import {
  getRouteApi,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";

import { BillEditor } from "./BillEditor";

const newBillRouteApi = getRouteApi("/new-bill");

export function NewBillScreen() {
  const navigate = useNavigate();
  const { source: billEntrySource } = newBillRouteApi.useSearch();
  const isFromReceiptScan = billEntrySource === "scan";
  const receiptFile = useRouterState({
    select: (s) =>
      (s.location.state as { receiptFile?: File } | undefined)?.receiptFile,
  });

  return (
    <BillEditor
      mode={{
        kind: "create",
        isFromReceiptScan,
        receiptFile,
      }}
      onBack={() => navigate({ to: "/" })}
      onOpenBill={(billId) =>
        navigate({ to: "/bills/$billId", params: { billId } })
      }
    />
  );
}
