export const schemaMigrations = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const v1InitialSchema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_chat_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bill_sessions (
  id TEXT PRIMARY KEY,
  group_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS receipt_images (
  id TEXT PRIMARY KEY,
  bill_session_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  ocr_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bill_session_id) REFERENCES bill_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bill_items (
  id TEXT PRIMARY KEY,
  bill_session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  total_price_cents INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bill_session_id) REFERENCES bill_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS item_assignments (
  id TEXT PRIMARY KEY,
  bill_item_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bill_item_id, user_id),
  FOREIGN KEY (bill_item_id) REFERENCES bill_items(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY,
  bill_session_id TEXT NOT NULL,
  charge_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bill_session_id) REFERENCES bill_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  bill_session_id TEXT NOT NULL,
  payer_user_id INTEGER NOT NULL,
  payee_user_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bill_session_id) REFERENCES bill_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (payer_user_id) REFERENCES users(id),
  FOREIGN KEY (payee_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  bill_session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bill_session_id) REFERENCES bill_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bill_sessions_group_status
  ON bill_sessions(group_id, status);
CREATE INDEX IF NOT EXISTS idx_bill_items_session
  ON bill_items(bill_session_id);
CREATE INDEX IF NOT EXISTS idx_assignments_item
  ON item_assignments(bill_item_id);
CREATE INDEX IF NOT EXISTS idx_settlements_session_status
  ON settlements(bill_session_id, status);
`;

/** Adds when/where metadata for each bill session. */
export const v2BillSessionDatePlace = `
ALTER TABLE bill_sessions ADD COLUMN bill_date TEXT NOT NULL DEFAULT (date('now'));
ALTER TABLE bill_sessions ADD COLUMN place TEXT;
`;

/** ISO 4217 currency for display and settlement (OCR or user-chosen for manual bills). */
export const v3BillCurrency = `
ALTER TABLE bill_sessions ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
`;

/** Persist per-member manual paid status for split checklist UI. */
export const v4MemberPaymentStatus = `
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
`;

/** Per-group Telegram roster: cached member_count + optional WebApp photo_url. */
export const v5GroupRoster = `
ALTER TABLE groups ADD COLUMN member_count INTEGER;
ALTER TABLE users ADD COLUMN photo_url TEXT;
`;

/** First-class bill participants (independent of item_assignments). */
export const v6BillSessionMembers = `
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
`;

/**
 * Rename open/settled statuses: active→pending, settled→completed.
 * Promote drafts that already have members (opened but stuck as draft).
 */
export const v7BillSessionStatusPendingCompleted = `
UPDATE bill_sessions SET status = 'pending' WHERE status = 'active';
UPDATE bill_sessions SET status = 'completed' WHERE status = 'settled';
UPDATE bill_sessions
SET status = 'pending'
WHERE status = 'draft'
  AND EXISTS (
    SELECT 1 FROM bill_session_members m
    WHERE m.bill_session_id = bill_sessions.id
  );
`;

/** Promote drafts that were opened with assignees but no bill_session_members row. */
export const v8PromoteDraftsWithAssignments = `
UPDATE bill_sessions
SET status = 'pending', updated_at = datetime('now')
WHERE status = 'draft'
  AND EXISTS (
    SELECT 1 FROM bill_items i
    JOIN item_assignments a ON a.bill_item_id = i.id
    WHERE i.bill_session_id = bill_sessions.id
  );
`;

/**
 * DM readiness + optional payment copy-text for widget cards.
 * dm_started_at is set when the user messages the bot in private chat.
 */
export const v9UserDmAndPaymentDetails = `
ALTER TABLE users ADD COLUMN dm_started_at TEXT;
ALTER TABLE users ADD COLUMN payment_details TEXT;
`;
