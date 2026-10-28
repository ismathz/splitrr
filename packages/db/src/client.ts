import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations } from "./migrations";

export function createDb(sqlitePath: string): Database {
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new Database(sqlitePath, { create: true, strict: true });
  // Soften SQLITE_BUSY under concurrent API + bot writers (WAL already enabled in migrations).
  db.exec("PRAGMA busy_timeout = 5000;");
  applyMigrations(db);
  return db;
}
