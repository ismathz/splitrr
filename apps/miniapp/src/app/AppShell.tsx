import React, { useEffect, useRef } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { parseBillIdFromStartParam } from "@splitbot/shared";

import { useTelegramLaunchContext } from "@/lib/telegramLaunchContext";

export function AppShell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const launchCtx = useTelegramLaunchContext();
  const didRouteBillDeepLink = useRef(false);

  useEffect(() => {
    if (didRouteBillDeepLink.current) return;
    // start_param is base64url JSON `{cid,bid}`; decode must work in the
    // Telegram WebView (no Node Buffer — see shared base64url helpers).
    const billId = launchCtx.startParam
      ? parseBillIdFromStartParam(launchCtx.startParam)
      : null;
    if (!billId) return;

    if (pathname === `/bills/${billId}`) {
      didRouteBillDeepLink.current = true;
      return;
    }

    didRouteBillDeepLink.current = true;
    void navigate({
      to: "/bills/$billId",
      params: { billId },
      replace: true,
    });
  }, [launchCtx.startParam, pathname, navigate]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4 space-y-6">
      <Outlet />
    </main>
  );
}
