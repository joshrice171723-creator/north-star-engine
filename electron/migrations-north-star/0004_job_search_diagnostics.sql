CREATE TABLE IF NOT EXISTS job_search_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  lane_id TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  request_json TEXT NOT NULL DEFAULT '{}',
  http_status INTEGER,
  result_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  error_detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_search_attempts_run_idx ON job_search_attempts(run_id, created_at);