CREATE TABLE IF NOT EXISTS application_site_playbooks (
  id TEXT PRIMARY KEY NOT NULL,
  site_host TEXT NOT NULL,
  ats_key TEXT NOT NULL DEFAULT '',
  workflow_kind TEXT NOT NULL DEFAULT 'job_application',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  confidence REAL NOT NULL DEFAULT 0,
  playbook_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'ai_repair',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_repair_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS application_site_playbooks_identity_idx
  ON application_site_playbooks(site_host, ats_key, workflow_kind, version)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS application_site_playbooks_lookup_idx
  ON application_site_playbooks(site_host, ats_key, workflow_kind, status, confidence);

CREATE TABLE IF NOT EXISTS application_playbook_steps (
  id TEXT PRIMARY KEY NOT NULL,
  playbook_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  page_type TEXT NOT NULL DEFAULT '',
  page_fingerprint TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL,
  target_json TEXT NOT NULL DEFAULT '{}',
  arguments_json TEXT NOT NULL DEFAULT '{}',
  verification_json TEXT NOT NULL DEFAULT '{}',
  safety_class TEXT NOT NULL DEFAULT 'safe_navigation',
  confidence REAL NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS application_playbook_steps_identity_idx
  ON application_playbook_steps(playbook_id, step_order, step_key)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS application_playbook_repairs (
  id TEXT PRIMARY KEY NOT NULL,
  playbook_id TEXT,
  application_id TEXT NOT NULL,
  page_fingerprint TEXT NOT NULL DEFAULT '',
  failed_step_key TEXT NOT NULL DEFAULT '',
  observation_json TEXT NOT NULL DEFAULT '{}',
  proposed_plan_json TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT NOT NULL DEFAULT '{}',
  execution_json TEXT NOT NULL DEFAULT '{}',
  verification_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'proposed',
  model_name TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS application_playbook_repairs_lookup_idx
  ON application_playbook_repairs(application_id, page_fingerprint, created_at);
