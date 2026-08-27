ALTER TABLE job_applications ADD COLUMN automation_state TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE job_applications ADD COLUMN automation_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_applications ADD COLUMN automation_checkpoint_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE job_applications ADD COLUMN automation_next_retry_at TEXT;
CREATE INDEX IF NOT EXISTS job_applications_automation_queue_idx ON job_applications(automation_state, automation_next_retry_at, last_activity_at);
CREATE TABLE IF NOT EXISTS job_application_unknown_questions (
  id TEXT PRIMARY KEY NOT NULL, application_id TEXT NOT NULL, job_id TEXT NOT NULL,
  provider_host TEXT NOT NULL DEFAULT '', page_fingerprint TEXT NOT NULL DEFAULT '',
  control_label TEXT NOT NULL DEFAULT '', control_type TEXT NOT NULL DEFAULT '',
  question_key TEXT NOT NULL, question_text TEXT NOT NULL DEFAULT '', options_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open', answer_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT,
  FOREIGN KEY(application_id) REFERENCES job_applications(id), FOREIGN KEY(job_id) REFERENCES job_opportunities(id)
);
CREATE INDEX IF NOT EXISTS job_application_unknown_questions_queue_idx ON job_application_unknown_questions(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS job_application_unknown_questions_open_key_idx ON job_application_unknown_questions(application_id, question_key) WHERE status = 'open';
