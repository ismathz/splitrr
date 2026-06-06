CREATE TABLE IF NOT EXISTS bill_member_payment_status (
  id TEXT PRIMARY KEY,
  bill_session_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bill_session_id, member_name),
  FOREIGN KEY (bill_session_id) REFERENCES bill_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_payment_status_bill
  ON bill_member_payment_status(bill_session_id);
