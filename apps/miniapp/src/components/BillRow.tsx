import React, { useMemo } from "react";

import { MemberAvatar } from "@/components/MemberAvatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  useTelegramGroupMembers,
  type TelegramGroupMember,
} from "@/lib/telegramGroupMembers";
import { cn } from "@/lib/utils";

import {
  formatBillDateLabel,
  type BillDetails,
} from "@/app/billTypes";

const statusVariant: Record<
  BillDetails["status"],
  "draft" | "pending" | "completed"
> = {
  draft: "draft",
  pending: "pending",
  completed: "completed",
};

const AVATAR_STACK_LIMIT = 4;

export function BillStatusBadge({
  status,
  className,
}: {
  status: BillDetails["status"];
  className?: string;
}) {
  return (
    <Badge
      variant={statusVariant[status]}
      className={cn("capitalize", className)}
    >
      {status}
    </Badge>
  );
}

function BillMemberAvatarStack({ names }: { names: string[] }) {
  const { members: groupMembers } = useTelegramGroupMembers();
  const miniappApiBase = useMemo(
    () => import.meta.env.VITE_BOT_MINIAPP_API?.replace(/\/$/, "") ?? "",
    [],
  );

  const memberByName = useMemo(() => {
    const map = new Map<string, TelegramGroupMember>();
    for (const m of groupMembers) {
      map.set(m.name, m);
      map.set(m.name.toLowerCase(), m);
      const username = m.username?.trim();
      if (username) {
        map.set(username.toLowerCase(), m);
        map.set(`@${username.replace(/^@/, "").toLowerCase()}`, m);
      }
    }
    return map;
  }, [groupMembers]);

  const resolveMember = (name: string) => {
    const t = name.trim();
    return (
      memberByName.get(t) ??
      memberByName.get(t.toLowerCase()) ??
      memberByName.get(t.replace(/^@/, "").toLowerCase())
    );
  };

  const resolvePhotoUrl = (mem: TelegramGroupMember | undefined) => {
    if (!mem) return undefined;
    if (mem.photoUrl) return mem.photoUrl;
    if (mem.avatarProxyPath && miniappApiBase) {
      return `${miniappApiBase}${mem.avatarProxyPath}`;
    }
    return undefined;
  };

  const visible = names.slice(0, AVATAR_STACK_LIMIT);
  const overflow = names.length - visible.length;
  if (visible.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center" aria-hidden="true">
      {visible.map((name, index) => {
        const mem = resolveMember(name);
        return (
          <MemberAvatar
            key={`${name}-${index}`}
            name={name}
            avatarBgColors={mem?.avatarBgColors}
            photoUrl={resolvePhotoUrl(mem)}
            sizeClassName="h-6 w-6 text-[10px]"
            className={cn(
              "ring-2 ring-card",
              index > 0 && "-ml-2",
            )}
          />
        );
      })}
      {overflow > 0 ? (
        <span
          className={cn(
            "-ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full",
            "bg-surface-3 text-[10px] font-medium text-muted-foreground ring-2 ring-card",
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

export function BillRow({
  bill,
  onView,
}: {
  bill: BillDetails;
  onView: () => void;
}) {
  const members = useMemo(() => {
    if (bill.members?.length) {
      return bill.members.map((m) => m.trim()).filter(Boolean);
    }
    const seen = new Set<string>();
    const fromItems: string[] = [];
    for (const item of bill.items ?? []) {
      for (const name of item.assignees ?? []) {
        const t = name.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        fromItems.push(t);
      }
    }
    return fromItems;
  }, [bill.members, bill.items]);

  return (
    <Card
      className="cursor-pointer rounded-lg border-0 bg-card p-3.5 transition-[transform,background-color] duration-150 hover:bg-white/[0.08] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-medium tracking-[-0.01em]">
            {bill.title}
          </span>
          <BillStatusBadge status={bill.status} className="shrink-0" />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            <span>{formatBillDateLabel(bill.billDate)}</span>
            {bill.place ? (
              <>
                <span className="mx-1.5 text-white/20">·</span>
                <span>{bill.place}</span>
              </>
            ) : null}
          </div>
          {members.length > 0 ? (
            <BillMemberAvatarStack names={members} />
          ) : null}
        </div>
      </div>
    </Card>
  );
}
