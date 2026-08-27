CREATE TABLE IF NOT EXISTS api_call_log (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  purpose TEXT NOT NULL DEFAULT 'unknown',
  method TEXT NOT NULL DEFAULT 'GET',
  url TEXT NOT NULL DEFAULT '',
  request_headers_json TEXT NOT NULL DEFAULT '{}',
  request_body TEXT NOT NULL DEFAULT '',
  response_status INTEGER,
  response_headers_json TEXT NOT NULL DEFAULT '{}',
  response_body TEXT NOT NULL DEFAULT '',
  response_ok INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  timed_out INTEGER NOT NULL DEFAULT 0,
  error_name TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_call_log_run_idx ON api_call_log(run_id, created_at);
CREATE INDEX IF NOT EXISTS api_call_log_created_idx ON api_call_log(created_at);