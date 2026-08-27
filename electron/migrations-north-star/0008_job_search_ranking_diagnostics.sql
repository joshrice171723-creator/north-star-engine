CREATE TABLE IF NOT EXISTS job_search_ranking_batches (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  batch_number INTEGER NOT NULL,
  submitted_count INTEGER NOT NULL DEFAULT 0,
  assessed_count INTEGER NOT NULL DEFAULT 0,
  response_length INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS job_search_ranking_batches_run_idx ON job_search_ranking_batches(run_id, batch_number);