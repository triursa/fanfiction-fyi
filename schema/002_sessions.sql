-- fanfiction.fyi — Session storage
CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);