export const prerender = false;

import { queryAll } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;

  // Auth required
  const auth = await getAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const status = url.searchParams.get('status') || 'draft';
  const pseudId = Number(url.searchParams.get('pseud_id')) || 0;
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
  const offset = (page - 1) * limit;

  // Build the user's pseud list for filtering
  const pseudIds = auth.pseuds.map(p => p.id);
  if (pseudIds.length === 0) {
    return new Response(JSON.stringify({ works: [] }), {
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const pseudPlaceholders = pseudIds.map(() => '?').join(',');
  const bindings: any[] = [...pseudIds];

  let whereClause = '';

  if (status === 'draft') {
    // Drafts: works with published_at IS NULL (unpublished)
    whereClause = `AND w.published_at IS NULL`;
  } else if (status === 'published') {
    // Published: works with published_at IS NOT NULL
    whereClause = `AND w.published_at IS NOT NULL`;
  } else if (status === 'collection') {
    // Works that belong to a collection
    whereClause = `AND EXISTS (SELECT 1 FROM collection_items ci WHERE ci.work_id = w.id)`;
  }

  // Filter by specific pseud if requested
  if (pseudId > 0) {
    whereClause += ` AND cs.pseud_id = ?`;
    bindings.push(pseudId);
  }

  const sql = `
    SELECT w.id, w.title, w.summary, w.word_count, w.complete, w.published_at, w.updated_at,
           COUNT(DISTINCT c.id) as chapter_count
    FROM works w
    JOIN creatorships cs ON cs.work_id = w.id AND cs.pseud_id IN (${pseudPlaceholders})
    LEFT JOIN chapters c ON c.work_id = w.id
    WHERE 1=1 ${whereClause}
    GROUP BY w.id
    ORDER BY w.updated_at DESC
    LIMIT ? OFFSET ?
  `;

  bindings.push(limit, offset);

  const works = await queryAll<any>(db, sql, ...bindings);

  // Enrich with tags and pseuds
  for (const w of works) {
    w.tags = await queryAll<any>(db, `SELECT t.name, t.type FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ?1`, w.id);
    w.pseuds = await queryAll<any>(db, `SELECT p.name, p.icon_key FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ?1`, w.id);
  }

  return new Response(JSON.stringify({ works }), {
    headers: { 'Content-Type': 'application/json', ...cors },
  });
};