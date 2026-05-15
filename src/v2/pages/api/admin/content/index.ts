/**
 * Admin Content Moderation API
 * GET    /api/admin/content — list recent comments & published works
 * DELETE /api/admin/content — delete a comment or unpublish a work
 * Auth: required, mod+ only
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { requireAuth } from '@/v2/lib/auth';
import { getDb } from '@/v2/lib/db';
import { comments, works, pseuds, creatorships } from '@/v2/lib/schema/index';
import { logAudit } from '@/v2/lib/audit';
import { eq, and, desc, count, sql } from 'drizzle-orm';

// ─── Mod+ role check ─────────────────────────────────────────────
function requireMod(user: { role: string }): void {
  if (!['founder', 'admin', 'mod'].includes(user.role)) {
    throw new Response(JSON.stringify({ error: 'Forbidden: moderator access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── GET /api/admin/content ────────────────────────────────────────
export const GET: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireMod(auth.user);

  const section = url.searchParams.get('section') || 'comments';
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

  if (section === 'works') {
    // ── Published works with author pseud(s) via raw D1 query ──────
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
    const offset = (page - 1) * limit;

    const countResult = await d1.prepare(
      `SELECT COUNT(*) as total FROM works WHERE draft = 0`
    ).first();
    const total = (countResult?.total as number) || 0;

    const { results: workRows } = await d1.prepare(`
      SELECT w.id, w.title, w.word_count, w.published_at, w.created_at,
             GROUP_CONCAT(p.name, ', ') AS author_names
      FROM works w
      LEFT JOIN creatorships c ON c.work_id = w.id
      LEFT JOIN pseuds p ON p.id = c.pseud_id
      WHERE w.draft = 0
      GROUP BY w.id
      ORDER BY w.published_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    return new Response(JSON.stringify({ data: workRows, total, page, limit }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Comments with pseud name and work title via raw D1 query ──────
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = (page - 1) * limit;

  const countResult = await d1.prepare(
    `SELECT COUNT(*) as total FROM comments`
  ).first();
  const total = (countResult?.total as number) || 0;

  const { results: commentRows } = await d1.prepare(`
    SELECT c.id, c.content, c.created_at, c.updated_at,
           c.work_id, c.chapter_id, c.parent_id,
           p.name AS pseud_name,
           w.title AS work_title
    FROM comments c
    JOIN pseuds p ON p.id = c.pseud_id
    JOIN works w ON w.id = c.work_id
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  return new Response(JSON.stringify({ data: commentRows, total, page, limit }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ─── DELETE /api/admin/content ──────────────────────────────────────
export const DELETE: APIRoute = async ({ request, url, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  requireMod(auth.user);

  const db = getDb(d1);
  const type = url.searchParams.get('type');
  const id = Number(url.searchParams.get('id'));

  if (!id || isNaN(id)) {
    return new Response(JSON.stringify({ error: 'Valid id parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (type === 'comment') {
    // ── Delete comment ────────────────────────────────────────────
    const comment = await db.select().from(comments).where(eq(comments.id, id)).get();
    if (!comment) {
      return new Response(JSON.stringify({ error: 'Comment not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.delete(comments).where(eq(comments.id, id));
    await logAudit(d1, auth.user.id, 'comment.delete', 'comment', id, {
      workId: comment.workId,
      contentSnippet: (comment.content || '').slice(0, 200),
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (type === 'work') {
    // ── Unpublish work (set draft = 1) ────────────────────────────
    const work = await db.select().from(works).where(eq(works.id, id)).get();
    if (!work) {
      return new Response(JSON.stringify({ error: 'Work not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (work.draft === 1) {
      return new Response(JSON.stringify({ error: 'Work is already a draft' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.update(works).set({ draft: 1, updatedAt: new Date().toISOString() }).where(eq(works.id, id));
    await logAudit(d1, auth.user.id, 'work.unpublish', 'work', id, {
      title: work.title,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Invalid type parameter. Use "comment" or "work"' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
};