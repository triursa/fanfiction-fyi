-- Phase 0 migration: Fix tags UNIQUE constraint
-- Change from unique on (name) alone to composite unique on (name, type)
-- This allows the same tag name across different types (e.g. "Harry" as character AND fandom)

-- Remove the old inline unique constraint (SQLite doesn't support ALTER TABLE DROP CONSTRAINT,
-- so we drop and recreate the index)
DROP INDEX IF EXISTS idx_v2_tags_name_unique;

-- Add composite unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_tags_name_type ON tags(name, type);

-- Ensure regular name index still exists for lookups
CREATE INDEX IF NOT EXISTS idx_v2_tags_name ON tags(name);