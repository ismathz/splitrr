import React from "react";
import {
  createRoute,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

import { AppShell } from "./AppShell";
import { BillDetailsScreen } from "./screens/BillDetailsScreen";
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

const routeTree = rootRoute.addChildren([
  homeRoute,
  newBillRoute,
  billDetailsRoute,
]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

