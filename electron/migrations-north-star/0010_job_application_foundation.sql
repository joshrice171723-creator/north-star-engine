CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'drafting',
  application_url TEXT NOT NULL DEFAULT '',
  ats_key TEXT NOT NULL DEFAULT 'unknown',
  readiness_json TEXT NOT NULL DEFAULT '{}',
  unresolved_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  submitted_at TEXT,
  confirmation_number TEXT NOT NULL DEFAULT '',
  confirmation_url TEXT NOT NULL DEFAULT '',
  withdrawn_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY(job_id) REFERENCES job_opportunities(id)
);
CREATE INDEX IF NOT EXISTS job_applications_job_active_idx ON job_applications(job_id, deleted_at);
CREATE INDEX IF NOT EXISTS job_applications_status_activity_idx ON job_applications(status, last_activity_at);
CREATE UNIQUE INDEX IF NOT EXISTS job_applications_one_active_per_job_idx ON job_applications(job_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS job_application_answers (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT,
  question_key TEXT NOT NULL,
  question_text TEXT NOT NULL DEFAULT '',
  normalized_category TEXT NOT NULL DEFAULT 'unknown',
  answer_text TEXT NOT NULL DEFAULT '',
  answer_json TEXT NOT NULL DEFAULT 'null',
  scope TEXT NOT NULL DEFAULT 'application',
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  approval_status TEXT NOT NULL DEFAULT 'draft',
  autofill_policy TEXT NOT NULL DEFAULT 'ask',
  provenance_json TEXT NOT NULL DEFAULT '[]',
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS job_application_answers_active_idx ON job_application_answers(application_id, scope, deleted_at);

CREATE TABLE IF NOT EXISTS job_application_events (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_application_events_timeline_idx ON job_application_events(application_id, created_at);

ALTER TABLE user_profiles ADD COLUMN street TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN desired_salary INTEGER;
ALTER TABLE user_profiles ADD COLUMN notice_period TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN available_start_date TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN relocation_willingness TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN travel_willingness TEXT NOT NULL DEFAULT '';
