-- Migration 013: Mood Engine — chapter mood metadata + user mood-disabled preference
-- Issue #16: Mood Engine — Ambient Reading Companion

-- Add nullable mood column to chapters table
-- Values: NULL (default), 'cozy', 'tense', 'melancholy', 'triumphant', 'romantic', 'horror', 'flashback', 'action'
ALTER TABLE chapters ADD COLUMN mood TEXT DEFAULT NULL;

-- Add mood_disabled column to users table
-- When true, reader sees default palette regardless of chapter mood metadata
ALTER TABLE users ADD COLUMN mood_disabled INTEGER DEFAULT 0;