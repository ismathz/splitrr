import React, { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Toggle } from "@/components/ui/toggle";

import { mockBills, type Item } from "../billMock";
import { getItemDisplayEmoji } from "@/lib/itemEmoji";
import { ArrowLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";

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

function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
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
        <Toggle key={member} pressed className="text-sm p-1 pr-2.5 gap-1.5">
          <MemberAvatar name={member} />
          <span>{member}</span>
        </Toggle>
      ))}
    </div>
  );
}

export function BillDetailsScreen({ billId }: { billId: string }) {
  const bill = mockBills.find((b) => b.id === billId);

  const navigate = useNavigate();

  const membersOrdered = useMemo(
    () => (bill ? uniqueMembersInOrder(bill.items) : []),
    [bill],
  );
  const balances = useMemo(
    () =>
      bill ? balancesCentsByMember(bill.items) : new Map<string, number>(),
    [bill],
  );

  const [paidMemberNames, setPaidMemberNames] = useState<Set<string>>(
    () => new Set(),
  );

  const togglePaid = (name: string, next: boolean) => {
    setPaidMemberNames((prev) => {
      const nextSet = new Set(prev);
      if (next) nextSet.add(name);
      else nextSet.delete(name);
      return nextSet;
    });
  };

  const paidCount = membersOrdered.filter((m) => paidMemberNames.has(m)).length;

  if (!bill) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/" })}
            className="w-max"
          >
            <HugeiconsIcon
              icon={ArrowLeftIcon}
              strokeWidth={1.8}
              className="size-5"
            />
            Back to home
          </Button>
        </div>
        <Card className="rounded-xl border p-3">
          <div className="space-y-1">
            <CardTitle className="text-xl">Bill not found</CardTitle>
            <CardDescription>Mocked details view.</CardDescription>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            No bill exists for id: <span className="font-mono">{billId}</span>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="outline"
          onClick={() => navigate({ to: "/" })}
          className="w-max"
        >
          <HugeiconsIcon
            icon={ArrowLeftIcon}
            strokeWidth={1.8}
            className="size-5"
          />
          Back to home
        </Button>
      </div>

      <div className="space-y-4">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-xl">{bill.title}</CardTitle>
          <CardDescription>
            Status: <span className="font-mono">{bill.status}</span>
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
                <Badge>${(item.totalPriceCents / 100).toFixed(2)}</Badge>
              </div>

              <div className="w-full">
                <AssigneesRow assignees={item.assignees} />
              </div>
            </Card>
          ))}
        </div>

        {membersOrdered.length > 0 ? (
          <div className="space-y-2">
            <div>
              <CardTitle className="text-xl">Payments</CardTitle>
              <CardDescription>
                Mark who has paid their share ({paidCount} of{" "}
                {membersOrdered.length}).
              </CardDescription>
            </div>
            <Card className="rounded-xl border p-0 overflow-hidden">
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
                            onCheckedChange={(next) => togglePaid(name, next)}
                            aria-label={`${name} has paid`}
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
                          {formatUsd(cents)}
                        </Badge>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
