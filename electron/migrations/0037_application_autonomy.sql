-- Autonomy mode is opt-in. Supervised (the default) preserves every existing
-- user checkpoint exactly. Pre-authorized policies are one-time human decisions
-- that remove protected-category stops without live AI improvisation.
ALTER TABLE user_profiles ADD COLUMN autonomy_level TEXT NOT NULL DEFAULT 'supervised';
ALTER TABLE user_profiles ADD COLUMN preauthorized_policies_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_profiles ADD COLUMN preauthorized_attestations_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE user_profiles ADD COLUMN generated_credentials_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN autonomy_answer_confidence REAL;
