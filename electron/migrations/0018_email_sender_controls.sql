ALTER TABLE email_messages ADD COLUMN seen_at TEXT;
ALTER TABLE email_messages ADD COLUMN sender_key TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS email_sender_blocks (
  sender_key TEXT PRIMARY KEY,
  sender TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS email_messages_sender_idx ON email_messages(sender, received_at);
CREATE INDEX IF NOT EXISTS email_messages_sender_key_idx ON email_messages(sender_key, received_at);
