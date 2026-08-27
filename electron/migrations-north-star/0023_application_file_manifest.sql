ALTER TABLE job_applications ADD COLUMN application_folder_path TEXT NOT NULL DEFAULT '';
ALTER TABLE job_applications ADD COLUMN selected_resume_path TEXT NOT NULL DEFAULT '';
ALTER TABLE job_applications ADD COLUMN selected_cover_letter_path TEXT NOT NULL DEFAULT '';
