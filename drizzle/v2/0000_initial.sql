-- v2 Schema: Initial migration
-- Email/password auth only (no Google OAuth)

-- Users & Auth
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('founder', 'admin', 'mod', 'user')),
  display_name TEXT,
  avatar_key TEXT,
  bio TEXT DEFAULT '',
  email_visibility TEXT NOT NULL DEFAULT 'private' CHECK(email_visibility IN ('public', 'mutual', 'private')),
  reading_font_size TEXT NOT NULL DEFAULT 'default' CHECK(reading_font_size IN ('small', 'default', 'large', 'xlarge')),
  reading_skin_override TEXT NOT NULL DEFAULT 'author' CHECK(reading_skin_override IN ('author', 'default', 'typewriter', 'manuscript', 'terminal', 'parchment')),
  theme TEXT DEFAULT 'obsidian',
  approved INTEGER NOT NULL DEFAULT 1,
  banned INTEGER NOT NULL DEFAULT 0,
  suspended_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_v2_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  created_by_id INTEGER REFERENCES users(id),
  used_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_invite_codes_code ON invite_codes(code);

-- Pseuds (author identities)
CREATE TABLE IF NOT EXISTS pseuds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon_key TEXT,
  banner_key TEXT,
  theme_color TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  pinned_work_ids TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_pseuds_user_default ON pseuds(user_id) WHERE is_default = 1;

-- Works
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,
  notes TEXT,
  end_notes TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  word_count INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  draft INTEGER NOT NULL DEFAULT 1,
  work_skin TEXT NOT NULL DEFAULT 'default' CHECK(work_skin IN ('default', 'typewriter', 'manuscript', 'terminal', 'parchment')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chapters
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT 'Chapter 1',
  content_md TEXT,
  content_html TEXT,
  draft INTEGER NOT NULL DEFAULT 1,
  word_count INTEGER NOT NULL DEFAULT 0,
  images TEXT DEFAULT '[]',
  mood TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_chapters_work ON chapters(work_id, position);

-- Chapter Versions
CREATE TABLE IF NOT EXISTS chapter_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  content_md TEXT,
  content_html TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_chapter_versions ON chapter_versions(chapter_id, version);

-- Creatorships
CREATE TABLE IF NOT EXISTS creatorships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'author' CHECK(role IN ('author', 'coauthor', 'translator'))
);
CREATE INDEX IF NOT EXISTS idx_v2_creatorships_work ON creatorships(work_id);
CREATE INDEX IF NOT EXISTS idx_v2_creatorships_pseud ON creatorships(pseud_id);

-- Readings
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  for_later INTEGER NOT NULL DEFAULT 0,
  last_chapter INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_tags_name_type ON tags(name, type);
CREATE INDEX IF NOT EXISTS idx_v2_tags_type ON tags(type);
CREATE INDEX IF NOT EXISTS idx_v2_tags_name ON tags(name);

-- Taggings
CREATE TABLE IF NOT EXISTS taggings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v2_taggings_work ON taggings(work_id);
CREATE INDEX IF NOT EXISTS idx_v2_taggings_tag ON taggings(tag_id);

-- Kudos
CREATE TABLE IF NOT EXISTS kudos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_kudos_work_pseud ON kudos(work_id, pseud_id);

-- Bookmarks
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  notes TEXT,
  private INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_bookmarks_pseud_work ON bookmarks(pseud_id, work_id);

-- Collections
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  owner_pseud_id INTEGER REFERENCES pseuds(id),
  privacy TEXT NOT NULL DEFAULT 'open' CHECK(privacy IN ('open', 'moderated', 'closed', 'private', 'public', 'unrevealed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Collection Items
CREATE TABLE IF NOT EXISTS collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Series
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  creator_pseud_id INTEGER NOT NULL DEFAULT 0 REFERENCES pseuds(id),
  complete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_series_creator ON series(creator_pseud_id);

-- Serial Works
CREATE TABLE IF NOT EXISTS serial_works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_v2_serial_works_series ON serial_works(series_id, position);

-- Comments (threaded)
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  pseud_id INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_comments_work ON comments(work_id);
CREATE INDEX IF NOT EXISTS idx_v2_comments_parent ON comments(parent_id);

-- Content Reports
CREATE TABLE IF NOT EXISTS content_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('work', 'comment')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('harassment', 'spam', 'copyright', 'graphic', 'other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
  resolver_id INTEGER REFERENCES users(id),
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_reports_status ON content_reports(status);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_audit_actor ON audit_log(actor_id);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_v2_notifications_user ON notifications(user_id);

-- Notification Preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_notif_pref_user_type ON notification_preferences(user_id, type);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  rate_limit_tier TEXT NOT NULL DEFAULT 'free' CHECK(rate_limit_tier IN ('free', 'pro')),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_api_key_hash ON api_keys(key_hash);

-- Annotations
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  note_text TEXT,
  color TEXT NOT NULL DEFAULT 'yellow' CHECK(color IN ('yellow', 'green', 'blue', 'pink', 'orange')),
  shared_with_author INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_annotations_chapter_user ON annotations(chapter_id, user_id);
CREATE INDEX IF NOT EXISTS idx_v2_annotations_user ON annotations(user_id);

-- Full-Text Search (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS works_fts USING fts5(title, summary, content=works, content_rowid=id);