CREATE TABLE IF NOT EXISTS email_job_links (
  email_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (email_id)
);
CREATE INDEX IF NOT EXISTS email_job_links_job_idx ON email_job_links(job_id, created_at DESC);
