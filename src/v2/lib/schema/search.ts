/**
 * FTS5 Full-Text Search
 *
 * The FTS5 virtual table for full-text search is created via raw SQL migration,
 * not through Drizzle's schema DSL. Drizzle ORM does not support FTS5 table
 * definitions.
 *
 * The migration creates:
 *   CREATE VIRTUAL TABLE works_fts USING fts5(title, summary, content, content=works, content_rowid=id);
 *
 * Plus triggers to keep the FTS index in sync with the works table.
 *
 * This file exists as a placeholder to document the FTS5 setup.
 */
