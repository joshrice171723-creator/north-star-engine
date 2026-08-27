CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  thread_id TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  sender TEXT NOT NULL DEFAULT '',
  recipients TEXT NOT NULL DEFAULT '',
  received_at TEXT,
  body TEXT NOT NULL DEFAULT '',
  is_job_related INTEGER NOT NULL DEFAULT 0,
  classification_score INTEGER NOT NULL DEFAULT 0,
  matched_terms_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS email_messages_job_idx ON email_messages(is_job_related, received_at);
CREATE TABLE IF NOT EXISTS email_chunks (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(email_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS email_chunks_email_idx ON email_chunks(email_id);
