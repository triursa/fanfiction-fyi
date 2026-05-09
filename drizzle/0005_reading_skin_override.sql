-- Migration 0005: Add reading_skin_override column for Work Skins feature (#22)
ALTER TABLE users ADD COLUMN reading_skin_override TEXT DEFAULT 'author';
-- Values: 'default', 'typewriter', 'manuscript', 'terminal', 'parchment', 'author'