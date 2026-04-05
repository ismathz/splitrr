import { Database } from "bun:sqlite";
import { schemaMigrations, v1InitialSchema } from "./schema";

const orderedMigrations: Array<{ name: string; sql: string }> = [
  { name: "001_initial_schema.sql", sql: v1InitialSchema }
];

export function applyMigrations(db: Database): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(schemaMigrations);

  for (const migration of orderedMigrations) {
    const applied = db
      .query("SELECT 1 AS ok FROM schema_migrations WHERE filename = ?1")
      .get(migration.name) as { ok: number } | null;

    if (applied?.ok) {
      continue;
    }

    db.exec("BEGIN;");
    try {
      db.exec(migration.sql);
      db
        .query("INSERT INTO schema_migrations (filename) VALUES (?1)")
        .run(migration.name);
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
}
