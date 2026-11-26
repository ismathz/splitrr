import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import type { BillDetails } from "@/app/billTypes";
import {
  applyPaidToggleToCaches,
  findBillInHistoryCache,
  mapApiBillToDetails,
  patchBillCaches,
  paidNamesFrom,
  queryKeys,
  removeBillFromHistoryCaches,
  uniqueMembersInOrder,
  withPaidToggle,
  type PaymentStatusData,
} from "./queries";

function bill(id: string, over: Partial<BillDetails> = {}): BillDetails {
  return {
    id,
    title: `Bill ${id}`,
    status: "draft",
    currency: "USD",
    billDate: "2026-01-01",
    place: null,
    settled: false,
    items: [],
    ...over,
  };
}

describe("withPaidToggle", () => {
  test("updates an existing member without mutating the input", () => {
    const input: PaymentStatusData = {
      members: [
        { name: "Ann", paid: false },
        { name: "Bob", paid: false },
      ],
    };
    const next = withPaidToggle(input, "Ann", true);
    expect(next.members[0]).toEqual({ name: "Ann", paid: true });
    expect(input.members[0]!.paid).toBe(false);
  });

  test("adds a member that is not in the list", () => {
    expect(withPaidToggle(undefined, "Cy", true).members).toEqual([
      { name: "Cy", paid: true },
    ]);
  });

  test("paidNamesFrom keeps only paid, non-empty names", () => {
    const set = paidNamesFrom({
      members: [
        { name: " Ann ", paid: true },
        { name: "Bob", paid: false },
        { name: "  ", paid: true },
      ],
    });
    expect([...set]).toEqual(["Ann"]);
  });
});

describe("bill caches", () => {
  test("patchBillCaches updates the detail and the history row together", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.bill("a"), bill("a"));
    qc.setQueryData(queryKeys.history("chat"), [bill("a"), bill("b")]);
    patchBillCaches(qc, "a", (b) => ({ ...b, title: "New" }));
    expect(qc.getQueryData<BillDetails>(queryKeys.bill("a"))?.title).toBe(
      "New",
    );
    const history = qc.getQueryData<BillDetails[]>(queryKeys.history("chat"));
    expect(history?.map((b) => b.title)).toEqual(["New", "Bill b"]);
  });

  test("patchBillCaches does not create a detail entry that is absent", () => {
    const qc = new QueryClient();
    patchBillCaches(qc, "a", (b) => ({ ...b, title: "New" }));
    expect(qc.getQueryData(queryKeys.bill("a"))).toBeUndefined();
  });

  test("removeBillFromHistoryCaches drops the row", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.history("chat"), [bill("a"), bill("b")]);
    removeBillFromHistoryCaches(qc, "a");
    expect(
      qc.getQueryData<BillDetails[]>(queryKeys.history("chat"))?.map((b) => b.id),
    ).toEqual(["b"]);
  });

  test("findBillInHistoryCache finds a row in any chat's list", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.history("c1"), [bill("a")]);
    qc.setQueryData(queryKeys.history("c2"), [bill("b")]);
    expect(findBillInHistoryCache(qc, "b")?.id).toBe("b");
    expect(findBillInHistoryCache(qc, "zzz")).toBeUndefined();
  });

  test("applyPaidToggleToCaches completes the bill when everyone paid, and reverts", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.bill("a"), bill("a", { status: "pending" }));
    qc.setQueryData<PaymentStatusData>(queryKeys.paymentStatus("a"), {
      members: [
        { name: "Ann", paid: true },
        { name: "Bob", paid: false },
      ],
    });
    const members = ["Ann", "Bob"];
    applyPaidToggleToCaches(qc, "a", "Bob", true, members);
    const done = qc.getQueryData<BillDetails>(queryKeys.bill("a"));
    expect(done?.status).toBe("completed");
    expect(done?.settled).toBe(true);

    applyPaidToggleToCaches(qc, "a", "Bob", false, members);
    const back = qc.getQueryData<BillDetails>(queryKeys.bill("a"));
    expect(back?.status).toBe("pending");
    expect(back?.settled).toBe(false);
  });
});

describe("mapApiBillToDetails", () => {
  const api = {
    id: "a",
    title: "T",
    status: "pending" as const,
    currency: "USD",
    billDate: "2026-01-01",
    place: null,
    settled: false,
    items: [
      { id: "1", name: "x", totalPriceCents: 100, assignees: ["Ann", "Bob"] },
      { id: "2", name: "y", totalPriceCents: 100, assignees: ["Bob", "Cy"] },
    ],
  };

  test("falls back to assignees in first-seen order when members are absent", () => {
    expect(mapApiBillToDetails(api).members).toEqual(["Ann", "Bob", "Cy"]);
    expect(uniqueMembersInOrder(mapApiBillToDetails(api).items)).toEqual([
      "Ann",
      "Bob",
      "Cy",
    ]);
  });

  test("prefers trimmed explicit members", () => {
    expect(
      mapApiBillToDetails({ ...api, members: [" Zed ", ""] }).members,
    ).toEqual(["Zed"]);
  });
});
