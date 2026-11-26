import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";

import {
  createUserCachePersister,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
  persistDehydrateOptions,
  queryClient,
} from "@/lib/queryClient";
import { readTelegramLaunchContext } from "@/lib/telegramLaunchContext";

import { router } from "./router";

// Telegram's WebApp script is loaded synchronously in index.html, so the user
// is known before first render. No user (plain browser) means no persistence.
const telegramUserId = readTelegramLaunchContext().currentUser?.id;
const persister =
  telegramUserId != null ? createUserCachePersister(telegramUserId) : null;

export function AppRouter() {
  if (!persister) {
    return (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  }
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE_MS,
        buster: PERSIST_BUSTER,
        dehydrateOptions: persistDehydrateOptions,
      }}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  );
}
