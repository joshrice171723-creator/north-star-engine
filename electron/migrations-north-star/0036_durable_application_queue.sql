CREATE TABLE IF NOT EXISTS application_queue_runs (
  id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL DEFAULT 'entire_pipeline',
  status TEXT NOT NULL DEFAULT 'paused',
  active_item_id TEXT,
  message TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  paused_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS application_queue_runs_status_idx
  ON application_queue_runs(status, updated_at);

CREATE TABLE IF NOT EXISTS application_queue_items (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  blocker_json TEXT NOT NULL DEFAULT '{}',
  authorization_json TEXT NOT NULL DEFAULT '{}',
  browser_evidence_id TEXT,
  email_evidence_id TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  next_retry_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES application_queue_runs(id),
  FOREIGN KEY(application_id) REFERENCES job_applications(id),
  FOREIGN KEY(browser_evidence_id) REFERENCES job_application_submission_evidence(id),
  FOREIGN KEY(email_evidence_id) REFERENCES email_messages(id),
  UNIQUE(run_id, application_id)
);

CREATE INDEX IF NOT EXISTS application_queue_items_claim_idx
  ON application_queue_items(run_id, state, next_retry_at, position);
CREATE INDEX IF NOT EXISTS application_queue_items_application_idx
  ON application_queue_items(application_id, updated_at);
CREATE INDEX IF NOT EXISTS application_queue_items_lease_idx
  ON application_queue_items(lease_expires_at, lease_owner);
