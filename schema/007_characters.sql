-- fanfiction.fyi — Character Library (light wiki)
-- Phase 5: Characters as first-class entities with cross-fandom identity

-- ─── Character Groups (cross-fandom identity) ──────────
-- Groups multiple character entries that represent the "same" character
-- across different fandoms/adaptations. Optional — many characters
-- won't belong to any group.

CREATE TABLE IF NOT EXISTS character_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Characters ────────────────────────────────────────
-- First-class character entities with wiki-style metadata.
-- Each character is scoped to one fandom.
-- Multiple characters can share a group_id for cross-fandom identity.
-- tag_id links back to the existing tags table (character type) for
-- seamless coexistence with the work-tagging system.

CREATE TABLE IF NOT EXISTS characters (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  fandom        TEXT,
  group_id      INTEGER REFERENCES character_groups(id) ON DELETE SET NULL,
  tag_id        INTEGER REFERENCES tags(id) ON DELETE SET NULL,
  description   TEXT,
  short_desc    TEXT,
  avatar_key    TEXT,
  aliases       TEXT,           -- JSON array of alternate names
  created_by    INTEGER REFERENCES pseuds(id) ON DELETE SET NULL,
  updated_by    INTEGER REFERENCES pseuds(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_characters_group ON characters (group_id);
CREATE INDEX idx_characters_tag ON characters (tag_id);
CREATE INDEX idx_characters_fandom ON characters (fandom);
CREATE INDEX idx_characters_name ON characters (name);

-- ─── Character Appearances ──────────────────────────────
-- Links characters to works they appear in with role metadata.

CREATE TABLE IF NOT EXISTS character_appearances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id  INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  work_id       INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'side' CHECK (role IN ('protagonist','deuteragonist','antagonist','side','cameo')),
  notes         TEXT,
  added_by      INTEGER REFERENCES pseuds(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (character_id, work_id)
);

CREATE INDEX idx_char_appearances_char ON character_appearances (character_id);
CREATE INDEX idx_char_appearances_work ON character_appearances (work_id);