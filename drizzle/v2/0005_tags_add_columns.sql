-- Migration: Add missing columns to tags table
-- The Drizzle schema expects description, canonical, created_at, updated_at
-- but these were never added to the production D1 database.
-- NOTE: SQLite ALTER TABLE ADD COLUMN does not support non-constant defaults
-- like datetime('now'). We add columns without defaults and backfill separately.

-- Add missing columns (nullable or with constant defaults only)
ALTER TABLE tags ADD COLUMN description TEXT;
ALTER TABLE tags ADD COLUMN canonical INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tags ADD COLUMN created_at TEXT NOT NULL DEFAULT '2026-05-20 00:00:00';
ALTER TABLE tags ADD COLUMN updated_at TEXT NOT NULL DEFAULT '2026-05-20 00:00:00';

-- Backfill timestamps for existing rows
UPDATE tags SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at = '2026-05-20 00:00:00';

-- Note: The inline UNIQUE constraint on tags.name cannot be removed in SQLite
-- without recreating the table. The composite unique index idx_v2_tags_name_type
-- already exists from migration 0002. The name-only UNIQUE is more restrictive
-- than needed but won't cause issues with current data (all tag names are unique).
-- If we need to allow same name across types in the future, we'll need to
-- recreate the tags table without the inline UNIQUE constraint.