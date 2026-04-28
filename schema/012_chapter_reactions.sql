-- Chapter reactions: per-chapter emoji reactions (one per pseud per reaction type)
CREATE TABLE IF NOT EXISTS chapter_reactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id   INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  pseud_id     INTEGER NOT NULL REFERENCES pseuds(id) ON DELETE CASCADE,
  reaction     TEXT NOT NULL CHECK (reaction IN ('fire', 'cry', 'heartbreak', 'swords', 'heart', 'mindblown')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chapter_id, pseud_id, reaction)
);

CREATE INDEX idx_chapter_reactions_chapter ON chapter_reactions (chapter_id);
CREATE INDEX idx_chapter_reactions_pseud ON chapter_reactions (pseud_id);