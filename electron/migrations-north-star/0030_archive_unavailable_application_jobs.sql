-- Clean up legacy unavailable-listing checkpoints that were left in Ready to
-- apply. They are terminal history, not retryable queue work.
UPDATE job_opportunities
SET stage = 'rejected',
    archived = 0,
    deleted_at = NULL,
    updated_at = datetime('now')
WHERE stage = 'ready'
  AND deleted_at IS NULL
  AND id IN (
    SELECT job_id
    FROM job_applications
    WHERE deleted_at IS NULL
      AND automation_state = 'blocked'
      AND automation_checkpoint_json LIKE '%"reasonCode":"job_listing_unavailable"%'
  );
