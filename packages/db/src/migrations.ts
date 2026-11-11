import { Database } from "bun:sqlite";
import {
  schemaMigrations,
  v1InitialSchema,
  v2BillSessionDatePlace,
  v3BillCurrency,
  v4MemberPaymentStatus,
  v5GroupRoster,
  v6BillSessionMembers,
  v7BillSessionStatusPendingCompleted,
  v8PromoteDraftsWithAssignments,
  v9UserDmAndPaymentDetails,
} from "./schema";

const orderedMigrations: Array<{ name: string; sql: string }> = [
  { name: "001_initial_schema.sql", sql: v1InitialSchema },
  { name: "002_bill_date_place.sql", sql: v2BillSessionDatePlace },
  { name: "003_bill_currency.sql", sql: v3BillCurrency },
  { name: "004_member_payment_status.sql", sql: v4MemberPaymentStatus },
  { name: "005_group_roster.sql", sql: v5GroupRoster },
  { name: "006_bill_session_members.sql", sql: v6BillSessionMembers },
  {
    name: "007_bill_status_pending_completed.sql",
    sql: v7BillSessionStatusPendingCompleted,
  },
  {
    name: "008_promote_drafts_with_assignments.sql",
    sql: v8PromoteDraftsWithAssignments,
  },
  {
    name: "009_user_dm_payment_details.sql",
    sql: v9UserDmAndPaymentDetails,
  },
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
