-- A playbook step is a logical workflow step. Page fingerprints describe the
-- latest observed variant and must not create another step for the same action.
UPDATE application_playbook_steps AS keeper
SET
  success_count = (
    SELECT COALESCE(SUM(candidate.success_count), 0)
    FROM application_playbook_steps AS candidate
    WHERE candidate.playbook_id = keeper.playbook_id
      AND candidate.step_key = keeper.step_key
      AND candidate.deleted_at IS NULL
  ),
  failure_count = (
    SELECT COALESCE(SUM(candidate.failure_count), 0)
    FROM application_playbook_steps AS candidate
    WHERE candidate.playbook_id = keeper.playbook_id
      AND candidate.step_key = keeper.step_key
      AND candidate.deleted_at IS NULL
  ),
  confidence = (
    SELECT COALESCE(MAX(candidate.confidence), 0)
    FROM application_playbook_steps AS candidate
    WHERE candidate.playbook_id = keeper.playbook_id
      AND candidate.step_key = keeper.step_key
      AND candidate.deleted_at IS NULL
  )
WHERE keeper.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM application_playbook_steps AS newer
    WHERE newer.playbook_id = keeper.playbook_id
      AND newer.step_key = keeper.step_key
      AND newer.deleted_at IS NULL
      AND (
        newer.updated_at > keeper.updated_at
        OR (newer.updated_at = keeper.updated_at AND newer.rowid > keeper.rowid)
      )
  );

UPDATE application_playbook_steps AS older
SET deleted_at = CURRENT_TIMESTAMP
WHERE older.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM application_playbook_steps AS newer
    WHERE newer.playbook_id = older.playbook_id
      AND newer.step_key = older.step_key
      AND newer.deleted_at IS NULL
      AND (
        newer.updated_at > older.updated_at
        OR (newer.updated_at = older.updated_at AND newer.rowid > older.rowid)
      )
  );

DROP INDEX IF EXISTS application_playbook_steps_identity_idx;
CREATE UNIQUE INDEX IF NOT EXISTS application_playbook_steps_logical_identity_idx
  ON application_playbook_steps(playbook_id, step_key)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS application_playbook_learning_retries (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  site_host TEXT NOT NULL,
  ats_key TEXT NOT NULL DEFAULT '',
  workflow_kind TEXT NOT NULL DEFAULT 'job_application',
  step_key TEXT NOT NULL,
  page_fingerprint TEXT NOT NULL DEFAULT '',
  plan_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'ai_repair',
  last_error TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS application_playbook_learning_retries_active_idx
  ON application_playbook_learning_retries(application_id, workflow_kind, step_key)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS application_playbook_learning_retries_pending_idx
  ON application_playbook_learning_retries(resolved_at, next_retry_at, updated_at);
