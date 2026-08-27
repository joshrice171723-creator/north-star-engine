ALTER TABLE job_detail_activity ADD COLUMN read_at TEXT;
CREATE INDEX IF NOT EXISTS job_detail_activity_unread_idx ON job_detail_activity(job_id, activity_type, read_at);
