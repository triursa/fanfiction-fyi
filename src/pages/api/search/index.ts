export const prerender = false;

import { queryAll, queryFirst } from '@/lib/db';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;

  const rawQ = url.searchParams.get('q')?.trim() || '';
  const type = url.searchParams.get('type')?.trim() || undefined;
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const offset = (page - 1) * limit;

  // Faceted filter params
  const complete = url.searchParams.get('complete'); // '1' or '0'
  const wordCountMin = Number(url.searchParams.get('word_min')) || 0;
  const wordCountMax = Number(url.searchParams.get('word_max')) || 0;
  // Tag IDs filter: comma-separated tag IDs
  const tagIds = url.searchParams.get('tags')?.split(',').map(Number).filter(n => n > 0) || [];

  // Sanitize FTS5 query
  let ftsWhere = '';
  const ftsBindings: any[] = [];

  if (rawQ) {
    const words = rawQ.split(/\s+/).filter(w => /^[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+$/.test(w));
    const sanitizedQ = words.join(' ').trim();
    if (sanitizedQ) {
      ftsWhere = `JOIN works_fts f ON f.rowid = w.id AND works_fts MATCH ?`;
      ftsBindings.push(sanitizedQ);
    }
  }

  // Build WHERE conditions
  const conditions: string[] = ['w.published_at IS NOT NULL'];
  const bindings: any[] = [];

  if (complete === '1') conditions.push('w.complete = 1');
  if (complete === '0') conditions.push('w.complete = 0');
  if (wordCountMin > 0) { conditions.push('w.word_count >= ?'); bindings.push(wordCountMin); }
  if (wordCountMax > 0) { conditions.push('w.word_count <= ?'); bindings.push(wordCountMax); }
  if (type) { conditions.push(`w.id IN (SELECT tg.work_id FROM taggings tg JOIN tags t ON t.id = tg.tag_id WHERE t.type = ?)`); bindings.push(type); }
  if (tagIds.length > 0) {
    const tagPlaceholders = tagIds.map(() => '?').join(',');
    conditions.push(`w.id IN (SELECT tg.work_id FROM taggings tg WHERE tg.tag_id IN (${tagPlaceholders}))`);
    bindings.push(...tagIds);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Count query
  let countSql: string;
  let countBindings: any[];
  if (ftsWhere) {
    countSql = `SELECT COUNT(*) as total FROM works w ${ftsWhere} ${whereClause ? ' AND ' + conditions.join(' AND ') : ''}`;
    countBindings = [...ftsBindings];
    // Re-add non-FTS bindings for count (we already have conditions in whereClause)
  } else {
    countSql = `SELECT COUNT(*) as total FROM works w ${whereClause}`;
    countBindings = [...bindings];
  }

  // Actually, let's rebuild this more cleanly
  // The FTS MATCH needs to be in the FROM/JOIN clause, conditions go in WHERE
  if (ftsWhere) {
    countSql = `SELECT COUNT(*) as total FROM works w JOIN works_fts f ON f.rowid = w.id WHERE works_fts MATCH ?`;
    countBindings = [ftsBindings[0], ...bindings];
  } else {
    countSql = `SELECT COUNT(*) as total FROM works w ${whereClause}`;
    countBindings = [...bindings];
  }

  // Data query
  let dataSql: string;
  let dataBindings: any[];
  if (ftsWhere) {
    dataSql = `SELECT w.id, w.title, w.summary, w.word_count, w.complete, w.published_at, w.updated_at FROM works w JOIN works_fts f ON f.rowid = w.id WHERE works_fts MATCH ?`;
    // Append conditions (skip the published_at one since FTS already requires it)
    const extraConditions = conditions.slice(1); // all except published_at
    if (extraConditions.length > 0) {
      dataSql += ' AND ' + extraConditions.join(' AND ');
    }
    dataBindings = [ftsBindings[0], ...bindings];
    // Order by rank for FTS relevance
    dataSql += ' ORDER BY rank';
  } else {
    dataSql = `SELECT w.id, w.title, w.summary, w.word_count, w.complete, w.published_at, w.updated_at FROM works w ${whereClause}`;
    dataBindings = [...bindings];
    dataSql += ' ORDER BY w.updated_at DESC';
  }

  dataSql += ' LIMIT ? OFFSET ?';
  dataBindings.push(limit, offset);

  const results = await queryAll<any>(db, dataSql, ...dataBindings);
  const totalRow = await db.prepare(countSql).bind(...countBindings).first<{ total: number }>();
  const total = totalRow?.total ?? 0;

  // Enrich results with pseuds and tags
  for (const w of results) {
    const pseud = await queryAll<any>(
      db,
      `SELECT p.name FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ?1 LIMIT 1`,
      w.id
    );
    w.pseud_name = pseud[0]?.name ?? null;

    const tags = await queryAll<any>(
      db,
      `SELECT t.id, t.name, t.type FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ?1 ORDER BY t.type, t.name`,
      w.id
    );
    w.tags = tags;
  }

  return new Response(
    JSON.stringify({ results, total, page }),
    { headers: { 'Content-Type': 'application/json', ...cors } }
  );
};