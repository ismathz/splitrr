import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations } from "./migrations";

export function createDb(sqlitePath: string): Database {
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new Database(sqlitePath, { create: true, strict: true });
  applyMigrations(db);
  return db;
}
