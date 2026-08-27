ALTER TABLE application_workflow_steps ADD COLUMN observation_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE application_workflow_steps ADD COLUMN requires_user INTEGER NOT NULL DEFAULT 0;
