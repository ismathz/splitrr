import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { BillRow } from "@/components/BillRow";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  getGroupHistoryByTelegramChatId,
  getSplitbotApiBase,
  resolveBillContextForApi,
} from "@/lib/splitbotApi";
import { useTelegramLaunchContext } from "@/lib/telegramLaunchContext";
import { type BillDetails } from "../billTypes";
import { mockBills } from "../billDevMocks";
import { isDevMockDataEnabled } from "@/lib/devFlags";

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
        );
        if (cancelled) return;
        setServerBills(
          bills.map((bill) => ({
            ...bill,
            place: bill.place ?? null,
            members: bill.members ?? [],
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
  }, [splitbotApiBase, billApiContext]);

  const bills =
    serverBills ?? (isDevMockDataEnabled() ? mockBills : []);
  const showingDevMocks = isDevMockDataEnabled() && serverBills == null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-xl">All bills</CardTitle>
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
        <Card className="rounded-2xl p-4">
          <CardTitle className="text-base">
            {isLoadingHistory ? "Loading bills..." : "No bills yet"}
          </CardTitle>
          <CardDescription className="mt-1">
            {isLoadingHistory
              ? "Fetching bill history for this chat."
              : !splitbotApiBase
                ? "Connect to the API to load bills for this chat."
                : !billApiContext
                  ? "Open Splitrr from a Telegram group to see that chat’s bills."
                  : "No bills in this chat yet."}
          </CardDescription>
        </Card>
      )}
    </div>
  );
}
