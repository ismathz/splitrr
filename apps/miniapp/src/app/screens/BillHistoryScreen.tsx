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
  type BillDetails,
} from "../billTypes";
import { mockBills } from "../billDevMocks";
import { isDevMockDataEnabled } from "@/lib/devFlags";

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

  const bills =
    serverBills ?? (isDevMockDataEnabled() ? mockBills : []);
  const showingDevMocks = isDevMockDataEnabled() && serverBills == null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>All bills</CardTitle>
          <CardDescription>
            {showingDevMocks
              ? "Dev mock history (VITE_SPLITBOT_USE_MOCK_DATA)."
              : "Full bill history for this chat."}
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
              : !splitbotApiBase
                ? "Connect to the API to load bills for this chat."
                : !billApiContext
                  ? "Open Splitbot from a Telegram group to see that chat’s bills."
                  : "No bills in this chat yet."}
          </CardDescription>
        </Card>
      )}
    </div>
  );
}
