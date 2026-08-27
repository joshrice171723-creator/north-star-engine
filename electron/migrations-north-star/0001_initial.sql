-- North Star keeps only career settings and interview/application calendar support.
CREATE TABLE IF NOT EXISTS user_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS integrations_metadata (id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'disconnected', account_label TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', last_sync_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS integrations_provider_idx ON integrations_metadata(provider);
CREATE INDEX IF NOT EXISTS integrations_status_idx ON integrations_metadata(status);
CREATE TABLE IF NOT EXISTS calendar_events (id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL DEFAULT 'local', external_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', all_day INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS calendar_events_time_idx ON calendar_events(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS calendar_events_provider_idx ON calendar_events(provider, external_id);
CREATE INDEX IF NOT EXISTS calendar_events_active_idx ON calendar_events(deleted_at);
