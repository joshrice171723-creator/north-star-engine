CREATE TABLE IF NOT EXISTS job_application_sessions (
  id TEXT PRIMARY KEY NOT NULL, application_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'created',
  ats_key TEXT NOT NULL DEFAULT 'unknown', current_origin TEXT NOT NULL DEFAULT '', current_url_redacted TEXT NOT NULL DEFAULT '',
  page_title TEXT NOT NULL DEFAULT '', field_snapshot_json TEXT NOT NULL DEFAULT '[]', page_fingerprint TEXT NOT NULL DEFAULT '',
  unresolved_count INTEGER NOT NULL DEFAULT 0, last_error_code TEXT NOT NULL DEFAULT '', last_error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL, last_observed_at TEXT, ended_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_application_sessions_application_idx ON job_application_sessions(application_id, updated_at);
