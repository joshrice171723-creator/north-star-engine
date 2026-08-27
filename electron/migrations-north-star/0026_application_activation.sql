CREATE TABLE IF NOT EXISTS job_application_activation_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  host TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  activation_url_redacted TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL DEFAULT '',
  signals_json TEXT NOT NULL DEFAULT '[]',
  requested_at TEXT NOT NULL,
  matched_at TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES job_applications(id)
);
CREATE INDEX IF NOT EXISTS job_application_activation_application_idx ON job_application_activation_attempts(application_id, updated_at);
