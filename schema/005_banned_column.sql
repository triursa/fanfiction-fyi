-- fanfiction.fyi — Add banned column to users
ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;