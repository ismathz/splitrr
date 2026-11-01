CREATE TABLE IF NOT EXISTS bill_session_members (
  id TEXT PRIMARY KEY,
  bill_session_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bill_session_id, member_name),
  FOREIGN KEY (bill_session_id) REFERENCES bill_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bill_session_members_bill
  ON bill_session_members(bill_session_id);
