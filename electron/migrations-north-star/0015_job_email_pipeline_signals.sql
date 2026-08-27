ALTER TABLE email_messages ADD COLUMN matched_pipeline_signals_json TEXT NOT NULL DEFAULT '[]';
