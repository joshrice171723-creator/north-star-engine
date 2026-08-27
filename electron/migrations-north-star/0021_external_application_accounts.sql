CREATE TABLE IF NOT EXISTS job_application_external_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  host TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  credential_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'saved',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(application_id) REFERENCES job_applications(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS job_application_external_accounts_application_idx ON job_application_external_accounts(application_id);
CREATE INDEX IF NOT EXISTS job_application_external_accounts_host_idx ON job_application_external_accounts(host);
