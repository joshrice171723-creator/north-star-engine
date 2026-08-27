CREATE TABLE IF NOT EXISTS job_phone_assignments (
  phone_number TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (phone_number, job_id)
);
CREATE INDEX IF NOT EXISTS job_phone_assignments_phone_idx ON job_phone_assignments(phone_number);
