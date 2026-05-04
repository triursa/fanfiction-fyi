export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
import { bookmarks, works } from '@/lib/schema';
import { eq, and, or, like, gt, lt, gte, lte, sql, desc, asc, count, inArray } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const bookmarkRows = await db
    .select({
      id: bookmarks.id,
      pseudId: bookmarks.pseudId,
      workId: bookmarks.workId,
      notes: bookmarks.notes,
      private: bookmarks.private,
      createdAt: bookmarks.createdAt,
      title: works.title,
      summary: works.summary,
      wordCount: works.wordCount,
      complete: works.complete,
      workUpdatedAt: works.updatedAt,
    })
    .from(bookmarks)
    .innerJoin(works, eq(bookmarks.workId, works.id))
    .where(eq(bookmarks.pseudId, pseudId))
    .orderBy(desc(bookmarks.createdAt));

  const bookmarksList = bookmarkRows.map(bm => {
    const row: any = {
      id: bm.id,
      pseud_id: bm.pseudId,
      work_id: bm.workId,
      notes: bm.notes,
      private: bm.private,
      created_at: bm.createdAt,
      title: bm.title,
      summary: bm.summary,
      word_count: bm.wordCount,
      complete: bm.complete,
      work_updated_at: bm.workUpdatedAt,
    };
    if (row.notes) {
      row.notes_html = markdownToHtml(row.notes);
    }
    return row;
  });

  return new Response(JSON.stringify({ bookmarks: bookmarksList }), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { work_id, notes, private: isPrivate } = body || {};
  if (!work_id) return new Response(JSON.stringify({ error: 'work_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const pseudId = (body?.pseud_id && auth.pseuds.some((p: any) => p.id === Number(body.pseud_id))) ? Number(body.pseud_id) : auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const work = await db.select({ id: works.id }).from(works).where(eq(works.id, work_id)).get();
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  try {
    const result = await db.insert(bookmarks).values({
      pseudId,
      workId: work_id,
      notes: notes ?? null,
      private: isPrivate ? 1 : 0,
    });
    const lastRowId = Number(result.meta?.last_row_id ?? result[0]?.meta?.last_row_id);
    const bookmark = await db.select().from(bookmarks).where(eq(bookmarks.id, lastRowId)).get();
    return new Response(JSON.stringify(bookmark), { status: 201, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'Already bookmarked' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { work_id } = body || {};
  if (!work_id) return new Response(JSON.stringify({ error: 'work_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const result = await db.delete(bookmarks).where(and(eq(bookmarks.pseudId, pseudId), eq(bookmarks.workId, work_id)));
  if (Number(result.meta?.changes ?? result[0]?.meta?.changes) === 0) {
    return new Response(JSON.stringify({ error: 'Bookmark not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};