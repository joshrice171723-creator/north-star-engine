-- Separate names are opt-in verified profile values. Existing full_name remains
-- unchanged so profiles with multi-part names are never guessed or rewritten.
ALTER TABLE user_profiles ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
