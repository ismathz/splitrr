import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  getGroupHistoryByTelegramChatId,
  getSplitbotApiBase,
  resolveBillContextForApi,
} from "@/lib/splitbotApi";
import { useTelegramLaunchContext } from "@/lib/telegramLaunchContext";
import {
  formatBillDateLabel,
  mockBills,
  type BillDetails,
} from "../billMock";

const billStatusBadgeClass: Record<BillDetails["status"], string> = {
  draft: "bg-sky-500/15 text-sky-700",
  active: "bg-amber-500/15 text-amber-700",
  settled: "bg-emerald-500/15 text-emerald-700",
};

function BillRow({ bill, onView }: { bill: BillDetails; onView: () => void }) {
  return (
    <Card
      className="cursor-pointer rounded-lg border p-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onView}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onView();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{bill.title}</span>
          <Badge
            variant="secondary"
            className={`${billStatusBadgeClass[bill.status]} capitalize`}
          >
            {bill.status}
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          <span>{formatBillDateLabel(bill.billDate)}</span>
          {bill.place ? (
            <>
              <span className="mx-1.5 text-border">·</span>
              <span>{bill.place}</span>
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function BillHistoryScreen() {
  const navigate = useNavigate();
  const launchCtx = useTelegramLaunchContext();
  const splitbotApiBase = useMemo(() => getSplitbotApiBase(), []);
  const billApiContext = useMemo(
    () => resolveBillContextForApi(launchCtx),
    [
      launchCtx.chat?.id,
      launchCtx.chat?.title,
      launchCtx.startParam,
      launchCtx.chatType,
      launchCtx.currentUser?.id,
    ],
  );

  const [serverBills, setServerBills] = useState<BillDetails[] | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setServerBills(null);

    if (!splitbotApiBase || !billApiContext) return;

    setIsLoadingHistory(true);
    (async () => {
      try {
        const { bills } = await getGroupHistoryByTelegramChatId(
          splitbotApiBase,
          billApiContext.telegramChatId,
          launchCtx.currentUser?.id,
        );
        if (cancelled) return;
        setServerBills(
          bills.map((bill) => ({
            ...bill,
            place: bill.place ?? null,
            items: [],
          })),
        );
      } catch {
        if (!cancelled) {
          setServerBills(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [splitbotApiBase, billApiContext, launchCtx.currentUser?.id]);

  const bills = serverBills ?? mockBills;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>All bills</CardTitle>
          <CardDescription>
            {serverBills ? "Full bill history for this chat." : "Mocked history for now."}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate({ to: "/" })}>
          Back
        </Button>
      </div>

      {bills.length ? (
        <div className="space-y-2">
          {bills.map((bill) => (
            <BillRow
              key={bill.id}
              bill={bill}
              onView={() => navigate({ to: `/bills/${bill.id}` })}
            />
          ))}
        </div>
      ) : (
        <Card className="rounded-lg border p-4">
          <CardTitle className="text-base">
            {isLoadingHistory ? "Loading bills..." : "No bills yet"}
          </CardTitle>
          <CardDescription className="mt-1">
            {isLoadingHistory
              ? "Fetching your bill history."
              : "Create a new bill to get started."}
          </CardDescription>
        </Card>
      )}
    </div>
  );
}
