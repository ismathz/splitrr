import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";

import {
  formatBillDateLabel,
  mockBills,
  type BillDetails,
  type Item,
} from "../billMock";
import { BillEditor } from "./BillEditor";

const billStatusBadgeClass: Record<BillDetails["status"], string> = {
  draft: "bg-sky-500/15 text-sky-700",
  active: "bg-amber-500/15 text-amber-700",
  settled: "bg-emerald-500/15 text-emerald-700",
};
import { getItemDisplayEmoji } from "@/lib/itemEmoji";
import { ArrowLeftIcon, EllipsisVertical } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import {
  deleteBill,
  getBillDetails,
  getBillPaymentStatus,
  getSplitbotApiBase,
  updateBillPaymentStatus,
} from "@/lib/splitbotApi";
import { toUserFriendlyErrorMessage } from "@/lib/userFriendlyError";

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return initials || name.slice(0, 2).toUpperCase();
}

function getAvatarColors(name: string) {
  const seed = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const hue = seed % 360;
  const lightness = 38 + (seed % 18);
  const backgroundColor = `hsl(${hue} 80% ${lightness}%)`;
  const foregroundColor = lightness > 50 ? "#111827" : "#ffffff";
  return { backgroundColor, foregroundColor };
}

function MemberAvatar({ name }: { name: string }) {
  const initials = getInitials(name);
  const { backgroundColor, foregroundColor } = getAvatarColors(name);

  return (
    <span
      aria-hidden="true"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{ backgroundColor, color: foregroundColor }}
    >
      {initials}
    </span>
  );
}

function uniqueMembersInOrder(items: Item[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const item of items) {
    for (const name of item.assignees) {
      if (!seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
  }
  return ordered;
}

function balancesCentsByMember(items: Item[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const share = Math.floor(
      item.totalPriceCents / Math.max(item.assignees.length, 1),
    );
    for (const member of item.assignees) {
      map.set(member, (map.get(member) ?? 0) + share);
    }
  }
  return map;
}

function formatBillMoney(currencyCode: string, cents: number) {
  return `${currencyCode} ${(cents / 100).toFixed(2)}`;
}

function AssigneesRow({ assignees }: { assignees: string[] }) {
  if (assignees.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No one assigned to this item.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {assignees.map((member) => (
        <Toggle
          key={member}
          className="rounded-full text-sm p-1 pr-2.5 gap-1.5"
        >
          <MemberAvatar name={member} />
          <span>{member}</span>
        </Toggle>
      ))}
    </div>
  );
}

export function BillDetailsScreen({ billId }: { billId: string }) {
  const [serverBill, setServerBill] = useState<BillDetails | null>(null);
  const [isLoadingBill, setIsLoadingBill] = useState(true);
  const [loadBillError, setLoadBillError] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const splitbotApiBase = useMemo(() => getSplitbotApiBase(), []);
  const mockBill = useMemo(
    () => mockBills.find((b) => b.id === billId),
    [billId],
  );
  const bill = serverBill ?? mockBill;

  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setIsLoadingBill(true);
    setLoadBillError(null);
    setServerBill(null);

    if (!splitbotApiBase) {
      setIsLoadingBill(false);
      return;
    }

    (async () => {
      try {
        const fetched = await getBillDetails(splitbotApiBase, billId);
        if (cancelled) return;
        setServerBill({
          ...fetched,
          items: fetched.items.map((item) => ({
            ...item,
            assignees: item.assignees ?? [],
          })),
        });
      } catch (e) {
        if (cancelled) return;
        if (!mockBill) {
          setLoadBillError(toUserFriendlyErrorMessage(e));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBill(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [billId, splitbotApiBase, mockBill, reloadToken]);

  const membersOrdered = useMemo(
    () => (bill ? uniqueMembersInOrder(bill.items) : []),
    [bill],
  );
  const balances = useMemo(
    () =>
      bill ? balancesCentsByMember(bill.items) : new Map<string, number>(),
    [bill],
  );
  const subtotalCents = useMemo(
    () =>
      bill
        ? bill.items.reduce(
            (sum, item) => sum + Math.max(item.totalPriceCents, 0),
            0,
          )
        : 0,
    [bill],
  );
  const taxCents = 0;
  const additionalChargesCents = 0;
  const grandTotalCents = subtotalCents + taxCents + additionalChargesCents;

  const [paidMemberNames, setPaidMemberNames] = useState<Set<string>>(
    () => new Set(),
  );
  const [savingPaidMemberNames, setSavingPaidMemberNames] = useState<
    Set<string>
  >(() => new Set());
  const [paymentStatusError, setPaymentStatusError] = useState<string | null>(
    null,
  );
  const [paymentToastMessage, setPaymentToastMessage] = useState<string | null>(
    null,
  );
  const [isActionsPopoverOpen, setIsActionsPopoverOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingBill, setIsDeletingBill] = useState(false);
  const [deleteBillError, setDeleteBillError] = useState<string | null>(null);

  const togglePaid = async (name: string, next: boolean) => {
    setPaymentStatusError(null);
    setPaidMemberNames((prev) => {
      const nextSet = new Set(prev);
      if (next) nextSet.add(name);
      else nextSet.delete(name);
      return nextSet;
    });

    if (!splitbotApiBase) return;

    setSavingPaidMemberNames((prev) => {
      const nextSet = new Set(prev);
      nextSet.add(name);
      return nextSet;
    });
    try {
      await updateBillPaymentStatus(splitbotApiBase, billId, {
        name,
        paid: next,
      });
    } catch (e) {
      const message = toUserFriendlyErrorMessage(e);
      // Revert immediately when persistence fails.
      setPaidMemberNames((prev) => {
        const nextSet = new Set(prev);
        if (next) nextSet.delete(name);
        else nextSet.add(name);
        return nextSet;
      });
      setPaymentStatusError(message);
      setPaymentToastMessage(message);
    } finally {
      setSavingPaidMemberNames((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(name);
        return nextSet;
      });
    }
  };

  const paidCount = membersOrdered.filter((m) => paidMemberNames.has(m)).length;

  useEffect(() => {
    let cancelled = false;
    setPaymentStatusError(null);
    setPaidMemberNames(new Set());

    if (!splitbotApiBase) return;

    (async () => {
      try {
        const { members } = await getBillPaymentStatus(splitbotApiBase, billId);
        if (cancelled) return;
        const nextPaid = new Set<string>();
        for (const member of members) {
          const name = member.name.trim();
          if (!name) continue;
          if (member.paid) nextPaid.add(name);
        }
        setPaidMemberNames(nextPaid);
      } catch (e) {
        if (cancelled) return;
        setPaymentStatusError(toUserFriendlyErrorMessage(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [splitbotApiBase, billId, reloadToken]);

  useEffect(() => {
    if (!paymentToastMessage) return;
    const timeoutId = window.setTimeout(() => {
      setPaymentToastMessage(null);
    }, 3500);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [paymentToastMessage]);

  const handleDeleteBill = async () => {
    if (!splitbotApiBase) {
      setDeleteBillError("Delete is only available when connected to the API.");
      return;
    }

    setDeleteBillError(null);
    setIsDeletingBill(true);
    try {
      await deleteBill(splitbotApiBase, billId);
      setIsDeleteDialogOpen(false);
      navigate({ to: "/" });
    } catch (e) {
      setDeleteBillError(toUserFriendlyErrorMessage(e));
    } finally {
      setIsDeletingBill(false);
    }
  };

  if (isLoadingBill) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/" })}
            className="px-2"
          >
            <HugeiconsIcon
              icon={ArrowLeftIcon}
              strokeWidth={1.8}
              className="size-5"
            />
          </Button>
        </div>
        <Card className="rounded-xl border p-3">
          <div className="space-y-1">
            <CardTitle className="text-xl">Loading bill…</CardTitle>
            <CardDescription>Fetching latest details.</CardDescription>
          </div>
        </Card>
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/" })}
            className="px-2"
          >
            <HugeiconsIcon
              icon={ArrowLeftIcon}
              strokeWidth={1.8}
              className="size-5"
            />
          </Button>
        </div>
        <Card className="rounded-xl border p-3">
          <div className="space-y-1">
            <CardTitle className="text-xl">Bill not found</CardTitle>
            <CardDescription>Could not load this bill.</CardDescription>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {loadBillError ?? "This bill could not be found."}
          </p>
        </Card>
      </div>
    );
  }

  if (isEditMode) {
    return (
      <BillEditor
        mode={{
          kind: "edit",
          billId: bill.id,
          initial: {
            title: bill.title,
            billDate: bill.billDate,
            place: bill.place ?? null,
            currency: bill.currency,
            items: bill.items.map((item) => ({
              ...item,
              assignees: item.assignees ?? [],
            })),
          },
        }}
        onBack={() => navigate({ to: "/" })}
        onCancel={() => setIsEditMode(false)}
        onSaveComplete={() => {
          setIsEditMode(false);
          setReloadToken((t) => t + 1);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/" })}
            className="px-2"
          >
            <HugeiconsIcon
              icon={ArrowLeftIcon}
              strokeWidth={1.8}
              className="size-5"
            />
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsEditMode(true)}
            className="w-max"
          >
            Edit
          </Button>

          <div className="ml-auto">
            <Popover
              open={isActionsPopoverOpen}
              onOpenChange={(nextOpen) => setIsActionsPopoverOpen(nextOpen)}
            >
              <PopoverTrigger
                render={<Button variant="outline" size="icon" />}
                aria-label="Open bill actions"
              >
                <HugeiconsIcon
                  icon={EllipsisVertical}
                  strokeWidth={1.8}
                  className="size-5"
                />
              </PopoverTrigger>
              <PopoverContent className="w-40 p-1">
                <Button
                  variant="ghost"
                  className="w-full justify-start text-destructive hover:text-destructive"
                  onClick={() => {
                    setDeleteBillError(null);
                    setIsActionsPopoverOpen(false);
                    setIsDeleteDialogOpen(true);
                  }}
                >
                  Delete
                </Button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-xl">{bill.title}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{formatBillDateLabel(bill.billDate)}</span>
            {bill.place ? (
              <>
                <span className="text-border">·</span>
                <span>{bill.place}</span>
              </>
            ) : null}
            <span className="text-border">·</span>
            <Badge
              variant="secondary"
              className={cn(billStatusBadgeClass[bill.status], "capitalize")}
            >
              {bill.status}
            </Badge>
          </CardDescription>
        </div>

        <div className="space-y-2">
          {bill.items.map((item) => (
            <Card key={item.id} className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="text-lg leading-none select-none"
                    aria-hidden
                  >
                    {getItemDisplayEmoji(item)}
                  </span>
                  <span className="font-medium">{item.name}</span>
                </div>
                <Badge>
                  {formatBillMoney(bill.currency, item.totalPriceCents)}
                </Badge>
              </div>

              <div className="w-full">
                <AssigneesRow assignees={item.assignees} />
              </div>
            </Card>
          ))}
        </div>

        <div className="space-y-2">
          <div>
            <CardTitle className="text-xl">Charges & tax</CardTitle>
          </div>
          <Card className="rounded-xl border p-3">
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-medium">
                  {formatBillMoney(bill.currency, subtotalCents)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="font-medium">
                  {formatBillMoney(bill.currency, taxCents)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Additional charges</dt>
                <dd className="font-medium">
                  {formatBillMoney(bill.currency, additionalChargesCents)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-2">
                <dt className="font-semibold">Total</dt>
                <dd className="font-semibold">
                  {formatBillMoney(bill.currency, grandTotalCents)}
                </dd>
              </div>
            </dl>
          </Card>
        </div>

        <div className="space-y-2">
          <div>
            <CardTitle className="text-xl">Split breakdown</CardTitle>
            <CardDescription>
              {membersOrdered.length > 0
                ? `Mark who has paid their share (${paidCount} of ${membersOrdered.length}).`
                : "Assign people to items to start tracking payments."}
            </CardDescription>
          </div>
          <Card className="rounded-xl border p-0 overflow-hidden">
            {membersOrdered.length > 0 ? (
              <ul className="divide-y">
                {membersOrdered.map((name) => {
                  const cents = balances.get(name) ?? 0;
                  const paid = paidMemberNames.has(name);
                  const id = `paid-${bill.id}-${name}`;
                  return (
                    <li key={name}>
                      <label
                        htmlFor={id}
                        className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3 hover:bg-muted/40"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <Checkbox
                            id={id}
                            checked={paid}
                            onCheckedChange={(next) =>
                              togglePaid(name, next === true)
                            }
                            aria-label={`${name} has paid`}
                            disabled={savingPaidMemberNames.has(name)}
                            className={cn(
                              "size-6 rounded-full",
                              paid &&
                                "border-green-600 bg-green-600 text-success-foreground",
                            )}
                          />
                          <MemberAvatar name={name} />
                          <span
                            className={`truncate font-medium ${paid ? "text-muted-foreground line-through" : ""}`}
                          >
                            {name}
                          </span>
                        </span>
                        <Badge
                          variant="secondary"
                          className={
                            paid ? "opacity-60 line-through" : undefined
                          }
                        >
                          {formatBillMoney(bill.currency, cents)}
                        </Badge>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No assigned members yet.
              </p>
            )}
          </Card>
        </div>
      </div>

      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(nextOpen) => {
          setIsDeleteDialogOpen(nextOpen);
          if (!nextOpen) {
            setDeleteBillError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete bill?</DialogTitle>
            <DialogDescription>
              This will permanently remove "{bill.title}" and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteBillError ? (
            <p className="text-sm text-destructive">{deleteBillError}</p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isDeletingBill}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteBill}
              disabled={isDeletingBill}
            >
              {isDeletingBill ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {paymentToastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 rounded-lg border border-destructive/30 bg-background px-3 py-2 text-sm text-destructive shadow-lg"
        >
          {paymentToastMessage}
        </div>
      ) : null}
    </div>
  );
}
