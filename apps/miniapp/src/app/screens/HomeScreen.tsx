import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { BillRow } from "@/components/BillRow";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { type BillDetails } from "../billTypes";
import { mockBills } from "../billDevMocks";
import { isDevMockDataEnabled } from "@/lib/devFlags";
import { pickReceiptImage } from "@/lib/pickReceiptImage";
import {
  getGroupHistoryByTelegramChatId,
  getSplitbotApiBase,
  resolveBillContextForApi,
} from "@/lib/splitbotApi";
import { useTelegramLaunchContext } from "@/lib/telegramLaunchContext";

const BILL_HISTORY_PREVIEW_LIMIT = 4;

export function HomeScreen() {
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
  const [isSelecting, setIsSelecting] = useState(false);
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
  const billHistoryPreview = bills.slice(0, BILL_HISTORY_PREVIEW_LIMIT);
  const hasMoreBills = bills.length > BILL_HISTORY_PREVIEW_LIMIT;
  const showingDevMocks = isDevMockDataEnabled() && serverBills == null;

  const goToNewBillScratch = () => {
    navigate({ to: "/new-bill", search: { source: "scratch" } });
  };

  const openReceiptPicker = async (source: "camera" | "gallery") => {
    if (isSelecting) return;
    setIsSelecting(true);
    try {
      const file = await pickReceiptImage(source);
      if (!file) return;
      navigate({
        to: "/new-bill",
        search: { source: "scan" },
        state: { receiptFile: file },
      });
    } finally {
      setIsSelecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-[24px]">
        <CardHeader>
          <CardTitle className="text-xl">Get started</CardTitle>
          <CardDescription>
            Scan with camera, upload from your gallery, or start from an empty
            bill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            className="w-full"
            disabled={isSelecting}
            onClick={() => {
              void openReceiptPicker("camera");
            }}
            size="lg"
          >
            <Icon name="IconScanCode" size={20} />
            Scan receipt
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              className="w-full"
              disabled={isSelecting}
              variant="outline"
              onClick={() => {
                void openReceiptPicker("gallery");
              }}
              size="lg"
            >
              <Icon name="IconAddImage" size={20} />
              Upload photo
            </Button>

            <Button
              className="w-full"
              disabled={isSelecting}
              variant="outline"
              onClick={goToNewBillScratch}
              size="lg"
            >
              <Icon name="IconPageEmpty" size={20} />
              Start empty
            </Button>
          </div>
        </CardContent>
      </Card>
      {bills.length > 0 ? (
        <div>
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-xl">Bill history</CardTitle>
              <CardDescription>
                {showingDevMocks
                  ? "Dev mock history (VITE_SPLITBOT_USE_MOCK_DATA)."
                  : "Your recent bills."}
              </CardDescription>
            </div>
            {hasMoreBills ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: "/bills" })}
              >
                See all
              </Button>
            ) : null}
          </div>
          <div className="mt-3 space-y-2">
            {billHistoryPreview.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                onView={() => navigate({ to: `/bills/${bill.id}` })}
              />
            ))}
          </div>
        </div>
      ) : null}
      {!bills.length ? (
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
                  : "No bills in this chat yet. Scan a receipt or start empty."}
          </CardDescription>
        </Card>
      ) : null}
    </div>
  );
}
