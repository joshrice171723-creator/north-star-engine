CREATE TABLE IF NOT EXISTS application_workflow_steps (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  checkpoint_version INTEGER NOT NULL DEFAULT 0,
  step_order INTEGER NOT NULL DEFAULT 0,
  step_key TEXT NOT NULL,
  step_type TEXT NOT NULL,
  page_fingerprint TEXT NOT NULL DEFAULT '',
  observation_id TEXT,
  plan_json TEXT NOT NULL DEFAULT '{}',
  execution_json TEXT NOT NULL DEFAULT '{}',
  verification_json TEXT NOT NULL DEFAULT '{}',
  outcome TEXT NOT NULL DEFAULT '',
  reason_code TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'deterministic_policy',
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS application_workflow_steps_idempotency_idx
  ON application_workflow_steps(idempotency_key);
CREATE INDEX IF NOT EXISTS application_workflow_steps_application_idx
  ON application_workflow_steps(application_id, created_at);
