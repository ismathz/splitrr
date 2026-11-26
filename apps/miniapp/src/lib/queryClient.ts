import { QueryClient, type DehydrateOptions } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

/**
 * Single app-wide cache. Cached data renders immediately and is refreshed in
 * the background once older than `staleTime` (other group members edit bills).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      retry: 1,
    },
  },
});

/** Restored data is shown at once, then refetched because it is older than `staleTime`. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60_000;
/** Bump to discard every user's persisted cache after a cache-shape change. */
export const PERSIST_BUSTER = "1";

/** Bot member avatar paths are signed, so they are refetched rather than restored. */
export const persistDehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: (query) =>
    query.state.status === "success" && query.queryKey[0] !== "bot-members",
};

/**
 * localStorage persister scoped to one Telegram user, so a shared device never
 * restores another person's bills. Null when storage is unavailable.
 */
export function createUserCachePersister(telegramUserId: number) {
  try {
    return createSyncStoragePersister({
      storage: window.localStorage,
      key: `splitrr-query-cache:${telegramUserId}`,
      throttleTime: 1000,
    });
  } catch {
    return null;
  }
}
