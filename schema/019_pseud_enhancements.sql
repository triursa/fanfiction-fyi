-- Pseud enhancements — visual identity, default pseud, stats
-- Issue #53: Alias Management UX Upgrade

-- Theme color for each pseud (hex color string, e.g. '#4A90D9')
ALTER TABLE pseuds ADD COLUMN theme_color TEXT DEFAULT NULL;

-- Default pseud flag (only one per user)
ALTER TABLE pseuds ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

-- Partial unique index: at most one default pseud per user
-- SQLite doesn't support CREATE UNIQUE INDEX ... WHERE directly in all contexts,
-- but D1 (SQLite 3.37+) supports partial indexes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pseuds_user_default ON pseuds(user_id) WHERE is_default = 1;