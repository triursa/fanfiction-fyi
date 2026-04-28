-- fanfiction.fyi — Schema 009: Series Ownership & Completion
-- Phase 6: Series Management

ALTER TABLE series ADD COLUMN creator_pseud_id INTEGER NOT NULL DEFAULT 0 REFERENCES pseuds(id);
ALTER TABLE series ADD COLUMN complete INTEGER NOT NULL DEFAULT 0;  -- 0=WIP, 1=complete

CREATE INDEX IF NOT EXISTS idx_series_creator ON series (creator_pseud_id);

-- Update existing series (if any) to have creator_pseud_id=0 temporarily
-- Will be fixed when series are edited or created via new API
UPDATE series SET creator_pseud_id = 0 WHERE creator_pseud_id IS NULL;