ALTER TABLE users ADD COLUMN avatar_path TEXT;
INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
