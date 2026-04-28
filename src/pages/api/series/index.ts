export const prerender = false;

import { queryFirst, run, queryAll } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;
  const page = Number(url.searchParams.get('page')) || 1;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const offset = (page - 1) * limit;

  const series = await queryAll<any>(
    db,
    `SELECT s.*, p.name as creator_name, p.id as creator_id,
            (SELECT COUNT(*) FROM serial_works WHERE series_id = s.id) as work_count
     FROM series s
     JOIN pseuds p ON s.creator_pseud_id = p.id
     ORDER BY s.updated_at DESC
     LIMIT ? OFFSET ?`,
    limit,
    offset
  );

  // Enrich with tags if work_count > 0 (get tags from first work for preview)
  for (const s of series) {
    if (s.work_count > 0) {
      const firstWork = await queryFirst<any>(
        db,
        `SELECT w.id FROM serial_works sw JOIN works w ON w.id = sw.work_id WHERE sw.series_id = ?1 ORDER BY sw.position LIMIT 1`,
        s.id
      );
      if (firstWork) {
        // Get fandom tags from first work for preview
        s.preview_fandoms = await queryAll<any>(
          db,
          `SELECT t.name FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ?1 AND t.type = 'fandom' LIMIT 3`,
          firstWork.id
        );
      }
    }
  }

  return new Response(JSON.stringify(series), { headers: { 'Content-Type': 'application/json', ...cors } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { title, description, pseud_id } = body || {};
  if (!title) return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const creatorPseudId = pseud_id || auth.pseuds[0]?.id;
  if (!creatorPseudId) return new Response(JSON.stringify({ error: 'No pseud available' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const result = await run(
    db,
    `INSERT INTO series (title, description, creator_pseud_id, complete, created_at, updated_at)
     VALUES (?1, ?2, ?3, 0, datetime('now'), datetime('now'))`,
    title,
    description || null,
    creatorPseudId
  );

  const series = await queryFirst<any>(db, `SELECT * FROM series WHERE id = ?1`, result.meta.last_row_id);

  return new Response(JSON.stringify({ series }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};