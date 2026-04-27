-- fanfiction.fyi — Add theme preference column to users
ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'obsidian';