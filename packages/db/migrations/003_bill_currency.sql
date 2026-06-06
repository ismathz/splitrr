-- Applied via packages/db/src/migrations.ts (v3BillCurrency); kept for reference.
ALTER TABLE bill_sessions ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
