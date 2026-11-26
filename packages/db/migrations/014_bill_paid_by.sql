ALTER TABLE bill_sessions ADD COLUMN paid_by_user_id INTEGER;

UPDATE bill_sessions
SET paid_by_user_id = created_by_user_id
WHERE paid_by_user_id IS NULL
  AND created_by_user_id IS NOT NULL;
