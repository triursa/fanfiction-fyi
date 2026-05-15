-- Migration: Canon + Characters tables
-- Phase 3: Lore entries, locations, canon references, character groups, characters, appearances, reactions, work relations

-- Lore entries
CREATE TABLE IF NOT EXISTS lore_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_v2_lore_entries_category ON lore_entries(category);
CREATE INDEX IF NOT EXISTS idx_v2_lore_entries_work_id ON lore_entries(work_id);

-- Locations
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL CHECK(type IN ('city', 'country', 'region', 'continent', 'other')),
  parent_id INTEGER REFERENCES locations(id),
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_v2_locations_type ON locations(type);

-- Canon references
CREATE TABLE IF NOT EXISTS canon_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  lore_entry_id INTEGER REFERENCES lore_entries(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_v2_canon_refs_entry_id ON canon_references(lore_entry_id);
CREATE INDEX IF NOT EXISTS idx_v2_canon_refs_location_id ON canon_references(location_id);

-- Lore edits
CREATE TABLE IF NOT EXISTS lore_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lore_entry_id INTEGER NOT NULL REFERENCES lore_entries(id) ON DELETE CASCADE,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_v2_lore_edits_entry_id ON lore_edits(lore_entry_id);

-- Location edits
CREATE TABLE IF NOT EXISTS location_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_v2_location_edits_location_id ON location_edits(location_id);

-- Character groups
CREATE TABLE IF NOT EXISTS character_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Characters
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  group_id INTEGER REFERENCES character_groups(id) ON DELETE SET NULL,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_characters_group ON characters(group_id);
CREATE INDEX IF NOT EXISTS idx_v2_characters_pseud ON characters(pseud_id);
CREATE INDEX IF NOT EXISTS idx_v2_characters_name ON characters(name);

-- Character appearances
CREATE TABLE IF NOT EXISTS character_appearances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'supporting' CHECK(role IN ('protagonist', 'antagonist', 'supporting', 'minor', 'other')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_char_appearances_char ON character_appearances(character_id);
CREATE INDEX IF NOT EXISTS idx_v2_char_appearances_work ON character_appearances(work_id);

-- Chapter reactions
CREATE TABLE IF NOT EXISTS chapter_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('like', 'love', 'sad', 'angry', 'wow', 'heart')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_chapter_reactions_chapter ON chapter_reactions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_v2_chapter_reactions_pseud ON chapter_reactions(pseud_id);

-- Work relations (sequels, prequels, spinoffs, etc.)
CREATE TABLE IF NOT EXISTS work_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  related_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('sequel', 'prequel', 'spinoff', 'inspired_by', 'alternate_universe', 'same_universe', 'other')),
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_work_relations_work ON work_relations(work_id);
CREATE INDEX IF NOT EXISTS idx_v2_work_relations_related_work ON work_relations(related_work_id);
CREATE INDEX IF NOT EXISTS idx_v2_work_relations_type ON work_relations(relation_type);