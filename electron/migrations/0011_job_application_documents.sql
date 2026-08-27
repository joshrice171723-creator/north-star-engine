CREATE TABLE IF NOT EXISTS job_application_documents (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL DEFAULT '{}',
  plain_text TEXT NOT NULL DEFAULT '',
  html_text TEXT NOT NULL DEFAULT '',
  provenance_json TEXT NOT NULL DEFAULT '[]',
  validation_json TEXT NOT NULL DEFAULT '{}',
  source_resume_version INTEGER,
  model_name TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  is_selected INTEGER NOT NULL DEFAULT 0,
  exported_pdf_path TEXT NOT NULL DEFAULT '',
  exported_text_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS job_application_documents_version_idx ON job_application_documents(application_id, document_type, version);
CREATE INDEX IF NOT EXISTS job_application_documents_selected_idx ON job_application_documents(application_id, document_type, is_selected, deleted_at);
