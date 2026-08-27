ALTER TABLE job_search_ranking_batches ADD COLUMN call_number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_search_ranking_batches ADD COLUMN total_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_search_ranking_batches ADD COLUMN prompt_characters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_search_ranking_batches ADD COLUMN max_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_search_ranking_batches ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;