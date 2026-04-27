-- fanfiction.fyi — Fix DEFAULT (datetime('now')) to CURRENT_TIMESTAMP
-- D1 does not support datetime('now') as a DEFAULT — use CURRENT_TIMESTAMP.
-- Pattern: create new table, copy data, drop old, rename.

-- ─── Comments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  chapter_id  INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  pseud_id    INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO comments_new SELECT * FROM comments;

DROP TABLE comments;

ALTER TABLE comments_new RENAME TO comments;

CREATE INDEX IF NOT EXISTS idx_comments_work ON comments (work_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);

-- ─── Readings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS readings_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pseud_id     INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  work_id      INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  for_later    INTEGER NOT NULL DEFAULT 0,
  last_chapter INTEGER,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (pseud_id, work_id)
);

INSERT INTO readings_new SELECT * FROM readings;

DROP TABLE readings;

ALTER TABLE readings_new RENAME TO readings;

-- ─── Bookmarks ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookmarks_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pseud_id   INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  work_id    INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  notes      TEXT,
  private    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (pseud_id, work_id)
);

INSERT INTO bookmarks_new SELECT * FROM bookmarks;

DROP TABLE bookmarks;

ALTER TABLE bookmarks_new RENAME TO bookmarks;