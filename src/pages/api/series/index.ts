export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { series, serialWorks, tags, taggings, pseuds, works } from '@/lib/schema';
import { getAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { eq, desc, sql, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const drz = getDrizzle(locals.runtime.env.DB as D1Database);
  const page = Number(url.searchParams.get('page')) || 1;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const offset = (page - 1) * limit;

  // Complex JOIN + subquery for work_count — use sql template
  const seriesRows = await drz.all<any>(sql`
    SELECT s.*, p.name as creator_name, p.id as creator_id,
            (SELECT COUNT(*) FROM serial_works WHERE series_id = s.id) as work_count
     FROM series s
     JOIN pseuds p ON s.creator_pseud_id = p.id
     ORDER BY s.updated_at DESC
     LIMIT ${limit} OFFSET ${offset}
  `);

  // Enrich with tags if work_count > 0 (get tags from first work for preview)
  for (const s of seriesRows) {
    if (s.work_count > 0) {
      const firstWork = await drz.all<any>(sql`
        SELECT w.id FROM serial_works sw JOIN works w ON w.id = sw.work_id WHERE sw.series_id = ${s.id} ORDER BY sw.position LIMIT 1
      `);
      if (firstWork.length > 0) {
        // Get fandom tags from first work for preview
        s.preview_fandoms = await drz.all<{ name: string }>(sql`
          SELECT t.name FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ${firstWork[0].id} AND t.type = 'fandom' LIMIT 3
        `);
      }
    }
  }

  return new Response(JSON.stringify(seriesRows), { headers: { 'Content-Type': 'application/json', ...cors } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { title, description, pseud_id } = body || {};
  if (!title) return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const creatorPseudId = pseud_id || auth.pseuds[0]?.id;
  if (!creatorPseudId) return new Response(JSON.stringify({ error: 'No pseud available' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const [inserted] = await drz.insert(series).values({
    title,
    description: description || null,
    creatorPseudId,
    complete: 0,
    createdAt: now,
    updatedAt: now,
  }).returning();

  // Convert camelCase to snake_case for API compatibility
  const seriesResult = {
    id: inserted.id,
    title: inserted.title,
    description: inserted.description,
    created_at: inserted.createdAt,
    updated_at: inserted.updatedAt,
    creator_pseud_id: inserted.creatorPseudId,
    complete: inserted.complete,
  };

  return new Response(JSON.stringify({ series: seriesResult }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};