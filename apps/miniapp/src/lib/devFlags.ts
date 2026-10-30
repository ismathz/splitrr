/**
 * Explicit opt-in for local mock/fixture data in the Mini App.
 * Off unless Vite is in DEV *and* `VITE_SPLITBOT_USE_MOCK_DATA=true`.
 * Production builds never enable this (`import.meta.env.DEV` is false).
 */
export function isDevMockDataEnabled(): boolean {
  return Boolean(
    import.meta.env.DEV &&
      import.meta.env.VITE_SPLITBOT_USE_MOCK_DATA === "true",
  );
}
