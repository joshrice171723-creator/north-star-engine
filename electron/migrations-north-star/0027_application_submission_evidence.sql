CREATE TABLE IF NOT EXISTS job_application_submission_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  browser_state TEXT NOT NULL DEFAULT 'unverified',
  browser_confirmation_url TEXT NOT NULL DEFAULT '',
  browser_confirmation_number TEXT NOT NULL DEFAULT '',
  email_id TEXT,
  email_signals_json TEXT NOT NULL DEFAULT '[]',
  confirmation_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'awaiting_email',
  requested_at TEXT NOT NULL,
  matched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES job_applications(id),
  FOREIGN KEY(email_id) REFERENCES email_messages(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS job_application_submission_evidence_active_idx ON job_application_submission_evidence(application_id) WHERE status IN ('awaiting_email', 'verified');
CREATE INDEX IF NOT EXISTS job_application_submission_evidence_email_idx ON job_application_submission_evidence(email_id, updated_at);
