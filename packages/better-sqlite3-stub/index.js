/**
 * @mtcute/node imports this package at load time. Bun cannot load the native better-sqlite3 addon.
 * Session storage is provided via `bun:sqlite` + BaseSqliteStorage instead (see apps/bot).
 */
export default function BetterSqlite3Stub() {
  throw new Error(
    "better-sqlite3 stub: use custom storage (bun:sqlite). This should not be called."
  );
}
