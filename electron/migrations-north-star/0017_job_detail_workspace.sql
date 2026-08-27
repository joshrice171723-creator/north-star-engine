CREATE TABLE IF NOT EXISTS job_calendar_links (
  job_id TEXT NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  calendar_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, calendar_event_id)
);
CREATE INDEX IF NOT EXISTS job_calendar_links_job_idx ON job_calendar_links(job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_follow_up_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source_email_id TEXT REFERENCES email_messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS job_follow_up_tasks_job_idx ON job_follow_up_tasks(job_id, status, due_date);

CREATE TABLE IF NOT EXISTS job_detail_activity (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_detail_activity_job_idx ON job_detail_activity(job_id, created_at DESC);
