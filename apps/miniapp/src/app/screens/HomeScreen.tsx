import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Camera01Icon,
  File,
  FileEmpty01FreeIcons,
  ImageUploadIcon,
  PlusSignIcon,
  Scan,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  formatBillDateLabel,
  type BillDetails,
} from "../billTypes";
import { mockBills } from "../billDevMocks";
import { isDevMockDataEnabled } from "@/lib/devFlags";
import {
  getGroupHistoryByTelegramChatId,
  getSplitbotApiBase,
  resolveBillContextForApi,
} from "@/lib/splitbotApi";
import { useTelegramLaunchContext } from "@/lib/telegramLaunchContext";

const BILL_HISTORY_PREVIEW_LIMIT = 4;

const billStatusBadgeClass: Record<BillDetails["status"], string> = {
  draft: "bg-sky-500/15 text-sky-700",
  pending: "bg-amber-500/15 text-amber-700",
  completed: "bg-emerald-500/15 text-emerald-700",
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
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

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
  const billHistoryPreview = bills.slice(0, BILL_HISTORY_PREVIEW_LIMIT);
  const hasMoreBills = bills.length > BILL_HISTORY_PREVIEW_LIMIT;
  const showingDevMocks = isDevMockDataEnabled() && serverBills == null;

  const goToNewBillScratch = () => {
    navigate({ to: "/new-bill", search: { source: "scratch" } });
  };

  return (
    <div className="space-y-6">
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Get started</CardTitle>
          <CardDescription>
            Scan with camera, upload from your gallery, or start from an empty
            bill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              setIsSelecting(false);
              const file = e.target.files?.[0];
              e.target.value = "";
              navigate({
                to: "/new-bill",
                search: { source: "scan" },
                state: file ? { receiptFile: file } : undefined,
              });
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              setIsSelecting(false);
              const file = e.target.files?.[0];
              e.target.value = "";
              navigate({
                to: "/new-bill",
                search: { source: "scan" },
                state: file ? { receiptFile: file } : undefined,
              });
            }}
          />

          <Button
            className="w-full"
            disabled={isSelecting}
            onClick={() => {
              setIsSelecting(true);
              cameraInputRef.current?.click();
            }}
            size="lg"
          >
            <HugeiconsIcon icon={Scan} strokeWidth={1.8} className="size-5" />
            Scan receipt
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              className="w-full"
              disabled={isSelecting}
              variant="outline"
              onClick={() => {
                setIsSelecting(true);
                galleryInputRef.current?.click();
              }}
              size="lg"
            >
              <HugeiconsIcon
                icon={ImageUploadIcon}
                strokeWidth={1.8}
                className="size-5"
              />
              Upload receipt
            </Button>

            <Button
              className="w-full"
              disabled={isSelecting}
              variant="outline"
              onClick={goToNewBillScratch}
              size="lg"
            >
              <HugeiconsIcon
                icon={FileEmpty01FreeIcons}
                strokeWidth={1.8}
                className="size-5"
              />
              Start empty
            </Button>
          </div>
        </CardContent>
      </Card>
      {bills.length > 0 ? (
        <div>
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Bill history</CardTitle>
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
          <div className="space-y-2 mt-3">
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
                  : "No bills in this chat yet. Scan a receipt or start empty."}
          </CardDescription>
        </Card>
      ) : null}
    </div>
  );
}
