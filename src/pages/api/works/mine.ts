export const prerender = false;

import { queryAll } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import type { APIRoute } from 'astro';

const VALID_STATUSES = ['draft', 'published', 'collection'] as const;
type WorkStatus = typeof VALID_STATUSES[number];

export const GET: APIRoute = async ({ url, locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;

  // Auth required — no CORS headers; this endpoint is same-origin only
  const auth = await getAuth(db, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const statusParam = url.searchParams.get('status') || 'draft';
  if (!(VALID_STATUSES as readonly string[]).includes(statusParam)) {
    return new Response(
      JSON.stringify({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const status = statusParam as WorkStatus;

  const pseudId = Number(url.searchParams.get('pseud_id')) || 0;
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
  const offset = (page - 1) * limit;

  // Build the user's pseud list for filtering
  const pseudIds = auth.pseuds.map(p => p.id);
  if (pseudIds.length === 0) {
    return new Response(JSON.stringify({ works: [] }), {
      headers: { 'Content-Type': 'application/json' },
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

  // Enrich with tags and pseuds using batched queries to avoid N+1 lookups
  if (works.length > 0) {
    const workIds = works.map((w: any) => w.id);
    const workPlaceholders = workIds.map(() => '?').join(',');

    const tagRows = await queryAll<any>(
      db,
      `SELECT tg.work_id, t.name, t.type
       FROM taggings tg
       JOIN tags t ON t.id = tg.tag_id
       WHERE tg.work_id IN (${workPlaceholders})`,
      ...workIds,
    );

    const pseudRows = await queryAll<any>(
      db,
      `SELECT c.work_id, p.name, p.icon_key
       FROM creatorships c
       JOIN pseuds p ON p.id = c.pseud_id
       WHERE c.work_id IN (${workPlaceholders})`,
      ...workIds,
    );

    const tagsByWorkId = new Map<number, Array<{ name: string; type: string }>>();
    for (const row of tagRows) {
      const existing = tagsByWorkId.get(row.work_id) ?? [];
      existing.push({ name: row.name, type: row.type });
      tagsByWorkId.set(row.work_id, existing);
    }

    const pseudsByWorkId = new Map<number, Array<{ name: string; icon_key: string }>>();
    for (const row of pseudRows) {
      const existing = pseudsByWorkId.get(row.work_id) ?? [];
      existing.push({ name: row.name, icon_key: row.icon_key });
      pseudsByWorkId.set(row.work_id, existing);
    }

    for (const w of works) {
      w.tags = tagsByWorkId.get(w.id) ?? [];
      w.pseuds = pseudsByWorkId.get(w.id) ?? [];
    }
  }

  return new Response(JSON.stringify({ works }), {
    headers: { 'Content-Type': 'application/json' },
  });
};