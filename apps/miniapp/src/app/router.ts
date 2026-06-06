import React from "react";
import {
  createRoute,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

import { AppShell } from "./AppShell";
import { BillDetailsScreen } from "./screens/BillDetailsScreen";
import { BillHistoryScreen } from "./screens/BillHistoryScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { NewBillScreen } from "./screens/NewBillScreen";

const rootRoute = createRootRoute({
  component: AppShell,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeScreen,
});

const newBillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/new-bill",
  validateSearch: (search: Record<string, unknown>) => ({
    source:
      search.source === "scratch" || search.source === "scan"
        ? search.source
        : undefined,
  }),
  component: NewBillScreen,
});

const billDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bills/$billId",
  component: () => {
    // Use a wrapper so we can pass the params to a strongly-typed component prop.
    const params = billDetailsRoute.useParams();
    return React.createElement(BillDetailsScreen, { billId: params.billId });
  },
});

const billHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bills",
  component: BillHistoryScreen,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  newBillRoute,
  billHistoryRoute,
  billDetailsRoute,
]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface HistoryState {
    receiptFile?: File;
  }
}

