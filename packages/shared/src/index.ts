export * from "./types";
export * from "./currency";
export * from "./allocateCents";
export * from "./billShares";
export * from "./sanitizeText";
/** Browser-safe initData / start_param parsers (no `node:crypto`). */
export * from "./telegramWebAppInitData";
export * from "./telegramToken";
/**
 * Widget HTML/data helpers and HMAC initData validation use Node builtins
 * (`node:zlib`, `node:crypto`). Import from subpaths instead of this barrel so
 * the Mini App Vite client never loads them:
 * - `@splitbot/shared/telegramWebAppAuth`
 * - `@splitbot/shared/widgets`
 */
