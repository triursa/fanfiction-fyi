-- fanfiction.fyi — Initial Schema
-- D1 (SQLite at the edge) for ~20 users

-- ─── Identity ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'mod', 'user')),
  invite_code TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pseuds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  icon_key    TEXT,  -- GCS object key for avatar
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

-- ─── Content ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS works (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  summary     TEXT,
  notes       TEXT,        -- author notes (displayed before chapter 1)
  end_notes   TEXT,        -- author notes (displayed after last chapter)
  language    TEXT NOT NULL DEFAULT 'en',
  word_count  INTEGER NOT NULL DEFAULT 0,
  complete    INTEGER NOT NULL DEFAULT 0,  -- 0=wip, 1=complete
  published_at TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 1,
  title       TEXT NOT NULL DEFAULT 'Chapter 1',
  content_md  TEXT,        -- raw markdown source
  content_html TEXT,       -- rendered HTML for display
  draft       INTEGER NOT NULL DEFAULT 1,  -- 1=draft, 0=posted
  word_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chapters_work ON chapters (work_id, position);

-- ─── Creatorship (links pseuds to works) ─────────────────

CREATE TABLE IF NOT EXISTS creatorships (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pseud_id    INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'author' CHECK (role IN ('author', 'coauthor', 'translator')),
  UNIQUE (pseud_id, work_id, role)
);

-- ─── Taxonomy ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL CHECK (type IN ('fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'))
);

CREATE INDEX idx_tags_type ON tags (type);
CREATE INDEX idx_tags_name ON tags (name);

CREATE TABLE IF NOT EXISTS taggings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  UNIQUE (tag_id, work_id)
);

CREATE INDEX idx_taggings_work ON taggings (work_id);
CREATE INDEX idx_taggings_tag ON taggings (tag_id);

-- ─── Organization ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  privacy     TEXT NOT NULL DEFAULT 'open' CHECK (privacy IN ('open', 'moderated', 'closed', 'private')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  work_id       INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  added_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (collection_id, work_id)
);

CREATE TABLE IF NOT EXISTS series (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS serial_works (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id   INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (series_id, work_id)
);

CREATE INDEX idx_serial_works_series ON serial_works (series_id, position);

-- ─── Social ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  chapter_id  INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  pseud_id    INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,  -- threaded
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_chapter ON comments (chapter_id, created_at);
CREATE INDEX idx_comments_work ON comments (work_id, created_at);

CREATE TABLE IF NOT EXISTS kudos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  pseud_id    INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (work_id, pseud_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pseud_id    INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  notes       TEXT,
  private     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pseud_id, work_id)
);

-- ─── Versioning ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chapter_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL DEFAULT 1,
  content_md  TEXT,
  content_html TEXT,
  note        TEXT,  -- e.g. "Fixed typo", "Major rewrite"
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chapter_versions ON chapter_versions (chapter_id, version);

-- ─── Reading History ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pseud_id    INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  for_later   INTEGER NOT NULL DEFAULT 0,  -- 0=read, 1=marked-for-later
  last_chapter INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pseud_id, work_id)
);

-- ─── Invite Codes ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invite_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  used_by     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  used_at     TEXT
);

-- ─── FTS5 Full-Text Search ──────────────────────────────

CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(
  title, summary, content,
  content=works,
  content_rowid=id,
  tokenize='porter unicode61'
);

-- FTS triggers to keep index in sync
CREATE TRIGGER works_ai AFTER INSERT ON works BEGIN
  INSERT INTO works_fts (rowid, title, summary, content)
    VALUES (new.id, new.title, new.summary, '');
END;

CREATE TRIGGER works_ad AFTER DELETE ON works BEGIN
  INSERT INTO works_fts (works_fts, rowid, title, summary, content)
    VALUES ('delete', old.id, old.title, old.summary, '');
END;

CREATE TRIGGER works_au AFTER UPDATE ON works BEGIN
  INSERT INTO works_fts (works_fts, rowid, title, summary, content)
    VALUES ('delete', old.id, old.title, old.summary, '');
  INSERT INTO works_fts (rowid, title, summary, content)
    VALUES (new.id, new.title, new.summary, '');
END;