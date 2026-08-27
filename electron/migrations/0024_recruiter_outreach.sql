CREATE TABLE IF NOT EXISTS outreach_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  source_evidence TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  verification_method TEXT NOT NULL DEFAULT '',
  verification_source TEXT NOT NULL DEFAULT '',
  confidence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_contacts_email_idx ON outreach_contacts(lower(email)) WHERE email <> '';

CREATE TABLE IF NOT EXISTS outreach_opportunities (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  job_fit_score INTEGER NOT NULL DEFAULT 0,
  contact_quality_score INTEGER NOT NULL DEFAULT 0,
  email_confidence_score INTEGER NOT NULL DEFAULT 0,
  job_freshness_score INTEGER NOT NULL DEFAULT 0,
  company_priority_score INTEGER NOT NULL DEFAULT 0,
  outreach_score INTEGER NOT NULL DEFAULT 0,
  resume_version TEXT NOT NULL DEFAULT '',
  resume_path TEXT NOT NULL DEFAULT '',
  email_subject TEXT NOT NULL DEFAULT '',
  email_body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate',
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  recipient TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  approved_at TEXT,
  sent_at TEXT,
  reply_received_at TEXT,
  last_followup_at TEXT,
  reply_classification TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_job_contact_idx ON outreach_opportunities(job_id, contact_id);
CREATE INDEX IF NOT EXISTS outreach_status_idx ON outreach_opportunities(status, updated_at);
CREATE INDEX IF NOT EXISTS outreach_contact_email_idx ON outreach_opportunities(recipient, sent_at);
