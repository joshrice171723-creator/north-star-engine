ALTER TABLE user_profiles ADD COLUMN must_have_skills_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_profiles ADD COLUMN nice_to_have_skills_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_profiles ADD COLUMN radius_miles INTEGER;
