-- Pseud as Portfolio — Living Author Pages (Issue #18)
-- Adds pinned_work_ids (JSON array of work IDs) and banner_key (R2 storage key) to pseuds table

ALTER TABLE pseuds ADD COLUMN pinned_work_ids TEXT DEFAULT '[]';
ALTER TABLE pseuds ADD COLUMN banner_key TEXT;