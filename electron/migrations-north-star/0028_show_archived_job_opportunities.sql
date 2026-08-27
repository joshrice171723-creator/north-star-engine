-- Archived opportunities belong in the visible combined rejected/withdrawn/archived column.
-- Restore legacy soft-deleted job rows so the pipeline can show their terminal history.
UPDATE job_opportunities
SET deleted_at = NULL,
    stage = 'rejected',
    updated_at = datetime('now')
WHERE deleted_at IS NOT NULL;
