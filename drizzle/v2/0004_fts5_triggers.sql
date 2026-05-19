-- FTS5 Content-Sync Triggers
-- These triggers keep the `works_fts` FTS5 virtual table in sync with the `works` table.
-- Without these triggers, search results become stale or missing after inserts/updates/deletes.

-- After INSERT on works: add new row to FTS index
CREATE TRIGGER IF NOT EXISTS works_ai AFTER INSERT ON works BEGIN
  INSERT INTO works_fts(rowid, title, summary) VALUES (new.id, new.title, new.summary);
END;

-- After UPDATE on works: remove old row from FTS index, then insert updated row
CREATE TRIGGER IF NOT EXISTS works_au AFTER UPDATE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, summary) VALUES ('delete', old.id, old.title, old.summary);
  INSERT INTO works_fts(rowid, title, summary) VALUES (new.id, new.title, new.summary);
END;

-- After DELETE on works: remove row from FTS index
CREATE TRIGGER IF NOT EXISTS works_ad AFTER DELETE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, summary) VALUES ('delete', old.id, old.title, old.summary);
END;