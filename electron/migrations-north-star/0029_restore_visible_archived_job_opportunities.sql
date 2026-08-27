-- Archived job opportunities use the rejected stage for the visible terminal
-- pipeline column. Clear the legacy archive flag so jobs.list() can return them.
UPDATE job_opportunities
SET archived = 0,
    stage = 'rejected',
    updated_at = datetime('now')
WHERE archived = 1
  AND deleted_at IS NULL
  AND stage = 'rejected';
