ALTER TABLE job_search_attempts ADD COLUMN preview_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE job_search_attempts ADD COLUMN total_available INTEGER NOT NULL DEFAULT 0;