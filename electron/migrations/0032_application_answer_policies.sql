CREATE TABLE IF NOT EXISTS application_answer_policies (
  id TEXT PRIMARY KEY NOT NULL,
  answer_id TEXT NOT NULL,
  normalized_category TEXT NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  autofill_policy TEXT NOT NULL DEFAULT 'ask',
  scope TEXT NOT NULL DEFAULT 'job_applications',
  matching_rules_json TEXT NOT NULL DEFAULT '{}',
  value_rules_json TEXT NOT NULL DEFAULT '{}',
  approved_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS application_answer_policies_category_idx
  ON application_answer_policies(normalized_category, autofill_policy, scope)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS application_answer_policies_answer_idx
  ON application_answer_policies(answer_id)
  WHERE deleted_at IS NULL;
