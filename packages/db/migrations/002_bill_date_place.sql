-- mirrored in src/schema.ts (v2BillSessionDatePlace)
ALTER TABLE bill_sessions ADD COLUMN bill_date TEXT NOT NULL DEFAULT (date('now'));
ALTER TABLE bill_sessions ADD COLUMN place TEXT;
