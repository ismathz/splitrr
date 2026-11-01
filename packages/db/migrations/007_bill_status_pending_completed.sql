-- Applied via packages/db/src/migrations.ts (v7BillSessionStatusPendingCompleted); kept for reference.
UPDATE bill_sessions SET status = 'pending' WHERE status = 'active';
UPDATE bill_sessions SET status = 'completed' WHERE status = 'settled';
UPDATE bill_sessions
SET status = 'pending'
WHERE status = 'draft'
  AND EXISTS (
    SELECT 1 FROM bill_session_members m
    WHERE m.bill_session_id = bill_sessions.id
  );
