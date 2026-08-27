CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL DEFAULT 'project',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'P1',
  order_index INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  next_action TEXT NOT NULL DEFAULT '',
  definition_of_done TEXT NOT NULL DEFAULT '',
  blocked_reason TEXT NOT NULL DEFAULT '',
  dependencies TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  security_privacy_notes TEXT NOT NULL DEFAULT '',
  source_context TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS projects_parent_idx ON projects(parent_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status);
CREATE INDEX IF NOT EXISTS projects_active_idx ON projects(archived, deleted_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  parent_task_id TEXT,
  release_id TEXT,
  phase_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'P1',
  order_index INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  next_action TEXT NOT NULL DEFAULT '',
  definition_of_done TEXT NOT NULL DEFAULT '',
  blocked_reason TEXT NOT NULL DEFAULT '',
  dependencies TEXT NOT NULL DEFAULT '',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  security_privacy_notes TEXT NOT NULL DEFAULT '',
  source_context TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(due_date);
CREATE INDEX IF NOT EXISTS tasks_hierarchy_idx ON tasks(release_id, phase_id, parent_task_id);
CREATE INDEX IF NOT EXISTS tasks_active_idx ON tasks(archived, deleted_at);

CREATE TABLE IF NOT EXISTS user_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', order_index INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS goals_status_idx ON goals(status);
CREATE INDEX IF NOT EXISTS goals_active_idx ON goals(deleted_at);
CREATE TABLE IF NOT EXISTS check_ins (id TEXT PRIMARY KEY NOT NULL, check_in_date TEXT NOT NULL, energy INTEGER, mood TEXT, reflection TEXT NOT NULL DEFAULT '', wins TEXT NOT NULL DEFAULT '', blockers TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS check_ins_date_idx ON check_ins(check_in_date);
CREATE INDEX IF NOT EXISTS check_ins_active_idx ON check_ins(deleted_at);
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS notes_entity_idx ON notes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS notes_active_idx ON notes(deleted_at);
CREATE TABLE IF NOT EXISTS briefings (id TEXT PRIMARY KEY NOT NULL, briefing_date TEXT NOT NULL, briefing_type TEXT NOT NULL DEFAULT 'daily', title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS briefings_date_idx ON briefings(briefing_date);
CREATE INDEX IF NOT EXISTS briefings_active_idx ON briefings(deleted_at);
CREATE TABLE IF NOT EXISTS integrations_metadata (id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'disconnected', account_label TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', last_sync_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS integrations_provider_idx ON integrations_metadata(provider);
CREATE INDEX IF NOT EXISTS integrations_status_idx ON integrations_metadata(status);
CREATE TABLE IF NOT EXISTS calendar_events (id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL DEFAULT 'local', external_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', all_day INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS calendar_events_time_idx ON calendar_events(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS calendar_events_provider_idx ON calendar_events(provider, external_id);
CREATE INDEX IF NOT EXISTS calendar_events_active_idx ON calendar_events(deleted_at);
