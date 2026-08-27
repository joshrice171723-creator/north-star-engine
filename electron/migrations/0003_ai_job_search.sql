ALTER TABLE job_opportunities ADD COLUMN external_id TEXT;
ALTER TABLE job_opportunities ADD COLUMN api_source TEXT;
ALTER TABLE job_opportunities ADD COLUMN canonical_url TEXT NOT NULL DEFAULT '';
ALTER TABLE job_opportunities ADD COLUMN raw_data_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE job_opportunities ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE job_opportunities ADD COLUMN requirements_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE job_opportunities ADD COLUMN posted_at TEXT;
ALTER TABLE job_opportunities ADD COLUMN expires_at TEXT;
ALTER TABLE job_opportunities ADD COLUMN salary_min INTEGER;
ALTER TABLE job_opportunities ADD COLUMN salary_max INTEGER;
ALTER TABLE job_opportunities ADD COLUMN salary_currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE job_opportunities ADD COLUMN remote_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE job_opportunities ADD COLUMN match_score INTEGER;
ALTER TABLE job_opportunities ADD COLUMN fit_tier TEXT;
ALTER TABLE job_opportunities ADD COLUMN match_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE job_opportunities ADD COLUMN last_evaluated_at TEXT;
ALTER TABLE job_opportunities ADD COLUMN last_seen_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_provider_external_idx ON job_opportunities(api_source, external_id) WHERE api_source IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY NOT NULL, full_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', linkedin_url TEXT NOT NULL DEFAULT '', github_url TEXT NOT NULL DEFAULT '', portfolio_url TEXT NOT NULL DEFAULT '', target_roles_json TEXT NOT NULL DEFAULT '[]', target_industries_json TEXT NOT NULL DEFAULT '[]', target_locations_json TEXT NOT NULL DEFAULT '[]', remote_preference TEXT NOT NULL DEFAULT 'any', minimum_salary INTEGER, salary_currency TEXT NOT NULL DEFAULT 'USD', work_authorization TEXT NOT NULL DEFAULT '', requires_sponsorship INTEGER NOT NULL DEFAULT 0, security_clearance TEXT NOT NULL DEFAULT '', years_experience INTEGER, interests_json TEXT NOT NULL DEFAULT '[]', excluded_keywords_json TEXT NOT NULL DEFAULT '[]', preferred_job_types_json TEXT NOT NULL DEFAULT '["full-time"]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS master_resumes (
  id TEXT PRIMARY KEY NOT NULL, raw_text TEXT NOT NULL DEFAULT '', professional_summary TEXT NOT NULL DEFAULT '', experience_json TEXT NOT NULL DEFAULT '[]', education_json TEXT NOT NULL DEFAULT '[]', skills_json TEXT NOT NULL DEFAULT '[]', projects_json TEXT NOT NULL DEFAULT '[]', certifications_json TEXT NOT NULL DEFAULT '[]', achievements_json TEXT NOT NULL DEFAULT '[]', source_filename TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'manual', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_search_runs (id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, result_count INTEGER NOT NULL DEFAULT 0, warning TEXT NOT NULL DEFAULT '');