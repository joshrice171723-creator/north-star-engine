CREATE TABLE IF NOT EXISTS job_opportunities (
  id TEXT PRIMARY KEY NOT NULL,
  company TEXT NOT NULL,
  role_title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT '',
  salary_range TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'target',
  priority TEXT NOT NULL DEFAULT 'medium',
  next_action TEXT NOT NULL DEFAULT '',
  follow_up_date TEXT,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  applied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_stage_idx ON job_opportunities(stage);
CREATE INDEX IF NOT EXISTS jobs_follow_up_idx ON job_opportunities(follow_up_date);
CREATE INDEX IF NOT EXISTS jobs_active_idx ON job_opportunities(archived, deleted_at);