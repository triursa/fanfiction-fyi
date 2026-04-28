export const prerender = false;

import { queryAll } from '@/lib/db';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;

  const rawQ = url.searchParams.get('q')?.trim();
  if (!rawQ) {
    return new Response(JSON.stringify({ error: 'Query parameter "q" is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
  // Sanitize FTS5 query — strip special operators that cause SQL errors
  const q = rawQ.replace(/["()*]/g, '').replace(/\b(AND|OR|NOT|NEAR)\b/gi, '').trim() || rawQ;

  const type = url.searchParams.get('type')?.trim() || undefined;
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const offset = (page - 1) * limit;

  // Build base FTS query
  let countSql = `SELECT COUNT(*) as total FROM works_fts f JOIN works w ON f.rowid = w.id WHERE works_fts MATCH ? AND w.published_at IS NOT NULL`;
  let dataSql = `SELECT w.id, w.title, w.summary, w.word_count, w.published_at FROM works_fts f JOIN works w ON f.rowid = w.id WHERE works_fts MATCH ? AND w.published_at IS NOT NULL`;
  const bindings: any[] = [q];
  const countBindings: any[] = [q];

  // Optional tag type filter via taggings join
  if (type) {
    dataSql += ` AND w.id IN (SELECT tg.work_id FROM taggings tg JOIN tags t ON t.id = tg.tag_id WHERE t.type = ?)`;
    countSql += ` AND w.id IN (SELECT tg.work_id FROM taggings tg JOIN tags t ON t.id = tg.tag_id WHERE t.type = ?)`;
    bindings.push(type);
    countBindings.push(type);
  }

  dataSql += ` ORDER BY rank LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const results = await queryAll<any>(db, dataSql, ...bindings);
  const totalRow = await db.prepare(countSql).bind(...countBindings).first<{ total: number }>();
  const total = totalRow?.total ?? 0;

  // Fetch first pseud for each result work
  for (const w of results) {
    const pseud = await queryAll<any>(
      db,
      `SELECT p.name FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ?1 LIMIT 1`,
      w.id
    );
    (w as any).pseud_name = pseud[0]?.name ?? null;
  }

  return new Response(
    JSON.stringify({ results, total, page }),
    { headers: { 'Content-Type': 'application/json', ...cors } }
  );
};