import type { User, Pseud, Work, Chapter, ChapterVersion, Tag, Tagging, Creatorship, Collection, Comment, Kudos, Bookmark, Session, InviteCode } from './types';

// Quick access to D1 from server routes / pages
export function getDb(Astro: { locals: { runtime: { env: { DB: D1Database } } } }): D1Database {
  return Astro.locals.runtime.env.DB;
}

// Small helper to bind and run first
export async function queryFirst<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first() as Promise<T | null>;
}

// Run a statement (insert/update/delete)
export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

// Query all rows
export async function queryAll<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const { results } = await stmt.all<T>();
  return results ?? [];
}
