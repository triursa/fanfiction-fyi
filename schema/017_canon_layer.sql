-- fanfiction.fyi — Canon Layer (Collaborative Worldbuilding Wiki)
-- Issue #19: Characters, locations, and lore as first-class wiki entities

-- ─── Lore Entries ──────────────────────────────────────
-- Wiki-style entries for any narrative concept: magic systems,
-- historical events, organizations, concepts, etc.
-- Scoped to fandoms via the existing tags table (fandom type).

CREATE TABLE IF NOT EXISTS lore_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  body_md       TEXT,
  body_html     TEXT,
  category      TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'magic', 'history', 'organization', 'concept', 'item', 'event', 'culture', 'species')),
  fandom_tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
  created_by    INTEGER REFERENCES pseuds(id) ON DELETE SET NULL,
  updated_by    INTEGER REFERENCES pseuds(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lore_entries_fandom ON lore_entries (fandom_tag_id);
CREATE INDEX idx_lore_entries_category ON lore_entries (category);
CREATE INDEX idx_lore_entries_slug ON lore_entries (slug);
CREATE INDEX idx_lore_entries_title ON lore_entries (title);

-- ─── Locations ─────────────────────────────────────────
-- Places within a fandom's world — cities, regions, buildings.
-- Hierarchical via parent_location_id (e.g. Paris → France → Europe).

CREATE TABLE IF NOT EXISTS locations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  description_md      TEXT,
  description_html    TEXT,
  fandom_tag_id       INTEGER REFERENCES tags(id) ON DELETE SET NULL,
  parent_location_id  INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  created_by          INTEGER REFERENCES pseuds(id) ON DELETE SET NULL,
  updated_by          INTEGER REFERENCES pseuds(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_locations_fandom ON locations (fandom_tag_id);
CREATE INDEX idx_locations_parent ON locations (parent_location_id);
CREATE INDEX idx_locations_slug ON locations (slug);
CREATE INDEX idx_locations_name ON locations (name);

-- ─── Entity References ─────────────────────────────────
-- Generic join table linking any entity (character, lore, location)
-- to works that reference it. Enables "Works referencing X" pages.

CREATE TABLE IF NOT EXISTS entity_references (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id      INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('character', 'lore', 'location')),
  entity_id    INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (work_id, entity_type, entity_id)
);

CREATE INDEX idx_entity_references_work ON entity_references (work_id);
CREATE INDEX idx_entity_references_entity ON entity_references (entity_type, entity_id);

-- ─── Lore Edit History ──────────────────────────────────
-- Track changes to lore entries (like AO3 tag wrangling, but for lore).

CREATE TABLE IF NOT EXISTS lore_edits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lore_entry_id INTEGER NOT NULL REFERENCES lore_entries(id) ON DELETE CASCADE,
  pseud_id      INTEGER REFERENCES pseuds(id) ON DELETE SET NULL,
  field         TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lore_edits_entry ON lore_edits (lore_entry_id);

-- ─── Location Edit History ──────────────────────────────

CREATE TABLE IF NOT EXISTS location_edits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id   INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  pseud_id      INTEGER REFERENCES pseuds(id) ON DELETE SET NULL,
  field         TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_location_edits_location ON location_edits (location_id);

-- ─── FTS for lore_entries ──────────────────────────────

CREATE VIRTUAL TABLE IF NOT EXISTS lore_entries_fts USING fts5(
  title,
  body_md,
  content='lore_entries',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS lore_entries_fts_insert AFTER INSERT ON lore_entries BEGIN
  INSERT INTO lore_entries_fts (rowid, title, body_md) VALUES (NEW.id, NEW.title, NEW.body_md);
END;

CREATE TRIGGER IF NOT EXISTS lore_entries_fts_update AFTER UPDATE ON lore_entries BEGIN
  INSERT INTO lore_entries_fts (lore_entries_fts, rowid, title, body_md) VALUES ('delete', OLD.id, OLD.title, OLD.body_md);
  INSERT INTO lore_entries_fts (rowid, title, body_md) VALUES (NEW.id, NEW.title, NEW.body_md);
END;

CREATE TRIGGER IF NOT EXISTS lore_entries_fts_delete AFTER DELETE ON lore_entries BEGIN
  INSERT INTO lore_entries_fts (lore_entries_fts, rowid, title, body_md) VALUES ('delete', OLD.id, OLD.title, OLD.body_md);
END;

-- ─── FTS for locations ──────────────────────────────────

CREATE VIRTUAL TABLE IF NOT EXISTS locations_fts USING fts5(
  name,
  description_md,
  content='locations',
  content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS locations_fts_insert AFTER INSERT ON locations BEGIN
  INSERT INTO locations_fts (rowid, name, description_md) VALUES (NEW.id, NEW.name, NEW.description_md);
END;

CREATE TRIGGER IF NOT EXISTS locations_fts_update AFTER UPDATE ON locations BEGIN
  INSERT INTO locations_fts (locations_fts, rowid, name, description_md) VALUES ('delete', OLD.id, OLD.name, OLD.description_md);
  INSERT INTO locations_fts (rowid, name, description_md) VALUES (NEW.id, NEW.name, NEW.description_md);
END;

CREATE TRIGGER IF NOT EXISTS locations_fts_delete AFTER DELETE ON locations BEGIN
  INSERT INTO locations_fts (locations_fts, rowid, name, description_md) VALUES ('delete', OLD.id, OLD.name, OLD.description_md);
END;