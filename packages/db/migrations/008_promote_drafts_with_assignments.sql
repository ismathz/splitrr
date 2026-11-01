-- Applied via packages/db/src/migrations.ts (v8PromoteDraftsWithAssignments); kept for reference.
UPDATE bill_sessions
SET status = 'pending', updated_at = datetime('now')
WHERE status = 'draft'
  AND EXISTS (
    SELECT 1 FROM bill_items i
    JOIN item_assignments a ON a.bill_item_id = i.id
    WHERE i.bill_session_id = bill_sessions.id
  );
