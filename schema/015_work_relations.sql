-- Work Relations: Lineage Graph — Recursive Fanwork Linking (Issue #17)
-- Tracks relationships between works: inspired_by, remix_of, response_to, alternate_pov, continuation_of, fix_it_for

CREATE TABLE IF NOT EXISTS work_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL,
  related_work_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('inspired_by', 'remix_of', 'response_to', 'alternate_pov', 'continuation_of', 'fix_it_for')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
  FOREIGN KEY (related_work_id) REFERENCES works(id) ON DELETE CASCADE,
  UNIQUE(work_id, related_work_id, relation_type)
);

-- Index for looking up relations from a work's perspective
CREATE INDEX IF NOT EXISTS idx_work_relations_work_id ON work_relations(work_id);

-- Index for reverse lookups (what works point TO this work)
CREATE INDEX IF NOT EXISTS idx_work_relations_related_work_id ON work_relations(related_work_id);

-- Index for filtering by relation type
CREATE INDEX IF NOT EXISTS idx_work_relations_type ON work_relations(relation_type);