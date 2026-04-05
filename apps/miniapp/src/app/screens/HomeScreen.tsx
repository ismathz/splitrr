import React, { useRef, useState } from "react";
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

import { mockBills, type BillDetails } from "../billMock";

const billStatusBadgeClass: Record<BillDetails["status"], string> = {
  uploaded: "bg-sky-500/15 text-sky-700",
  parsed: "bg-violet-500/15 text-violet-700",
  assigning: "bg-amber-500/15 text-amber-700",
  confirmed: "bg-emerald-500/15 text-emerald-700",
};

function BillRow({ bill, onView }: { bill: BillDetails; onView: () => void }) {
  return (
    <Card className="flex items-center justify-between rounded-lg border p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{bill.title}</span>
          <Badge
            variant="secondary"
            className={billStatusBadgeClass[bill.status]}
          >
            {bill.status}
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground font-mono break-all">
          {bill.id}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onView}>
        View
      </Button>
    </Card>
  );
}

export function HomeScreen() {
  const navigate = useNavigate();
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [isSelecting, setIsSelecting] = useState(false);

  const activeBills = mockBills.filter((b) => !b.settled);
  const settledBills = mockBills.filter((b) => b.settled);

  const goToNewBill = () => {
    navigate({ to: "/new-bill" });
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
            onChange={() => {
              setIsSelecting(false);
              goToNewBill();
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={() => {
              setIsSelecting(false);
              goToNewBill();
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
              onClick={goToNewBill}
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
      {activeBills.length > 0 ? (
        <div>
          <div className="space-y-1">
            <CardTitle>Active bills</CardTitle>
            <CardDescription>Bills that are not settled yet.</CardDescription>
          </div>
          <div className="space-y-2 mt-3">
            {activeBills.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                onView={() => navigate({ to: `/bills/${bill.id}` })}
              />
            ))}
          </div>
        </div>
      ) : null}
      {settledBills.length > 0 ? (
        <div>
          <div className="space-y-1">
            <CardTitle>Settled bills</CardTitle>
            <CardDescription>Mocked history for now.</CardDescription>
          </div>
          <div className="space-y-2 mt-3">
            {settledBills.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                onView={() => navigate({ to: `/bills/${bill.id}` })}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
