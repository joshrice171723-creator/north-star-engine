ALTER TABLE email_messages ADD COLUMN user_excluded INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS email_messages_user_excluded_idx ON email_messages(user_excluded, is_job_related, received_at);
