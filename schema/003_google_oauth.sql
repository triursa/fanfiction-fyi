-- fanfiction.fyi — Google OAuth + Founder role
-- Add 'founder' role to the users table CHECK constraint
-- SQLite doesn't support ALTER TABLE ... ALTER CONSTRAINT, so we recreate.

-- Step 1: Create new users table with expanded role
CREATE TABLE IF NOT EXISTS users_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,  -- nullable for OAuth-only users
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('founder', 'admin', 'mod', 'user')),
  google_id     TEXT,  -- Google sub claim for OAuth matching
  avatar_url    TEXT,  -- Google profile picture
  display_name  TEXT,  -- Google display name
  invite_code   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy existing data
INSERT INTO users_new (id, email, password_hash, role, invite_code, created_at, updated_at)
  SELECT id, email, password_hash, role, invite_code, created_at, updated_at FROM users;

-- Step 3: Drop old table and rename
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Step 4: Recreate indexes (auto-dropped with old table)
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users (google_id);

-- Step 5: Seed founder account (password_hash is NULL — OAuth-only)
INSERT OR IGNORE INTO users (email, role, google_id, display_name, created_at, updated_at)
  VALUES ('kaleb.bays@gmail.com', 'founder', NULL, 'Kaleb', datetime('now'), datetime('now'));
