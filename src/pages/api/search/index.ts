export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { tags, taggings, pseuds, creatorships, works } from '@/lib/schema';
import { inArray, sql, isNotNull, and } from 'drizzle-orm';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);

  const rawQ = url.searchParams.get('q')?.trim() || '';
  const type = url.searchParams.get('type')?.trim() || undefined;
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
  const offset = (page - 1) * limit;

  // Faceted filter params
  const complete = url.searchParams.get('complete'); // '1' or '0'
  const wordCountMin = Number(url.searchParams.get('word_min')) || 0;
  const wordCountMax = Number(url.searchParams.get('word_max')) || 0;
  const tagIds = url.searchParams.get('tags')?.split(',').map(Number).filter(n => n > 0) || [];

  // Sanitize FTS5 query
  let ftsMatch = '';
  const ftsBindings: any[] = [];

  if (rawQ) {
    const words = rawQ.split(/\s+/).filter(w => /^[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+$/.test(w));
    const sanitizedQ = words.join(' ').trim();
    if (sanitizedQ) {
      ftsMatch = `JOIN works_fts f ON f.rowid = w.id AND works_fts MATCH ?`;
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

  // Build count and data queries
  let countSql: string;
  let countBindings: any[];
  let dataSql: string;
  let dataBindings: any[];

  if (ftsMatch) {
    const allConditions = ' AND ' + conditions.join(' AND ');
    countSql = `SELECT COUNT(*) as total FROM works w ${ftsMatch} ${allConditions}`;
    countBindings = [ftsBindings[0], ...bindings];

    dataSql = `SELECT w.id, w.title, w.summary, w.word_count, w.complete, w.published_at, w.updated_at FROM works w ${ftsMatch} ${allConditions} ORDER BY rank`;
    dataBindings = [ftsBindings[0], ...bindings];
  } else {
    countSql = `SELECT COUNT(*) as total FROM works w ${whereClause}`;
    countBindings = [...bindings];

    dataSql = `SELECT w.id, w.title, w.summary, w.word_count, w.complete, w.published_at, w.updated_at FROM works w ${whereClause} ORDER BY w.updated_at DESC`;
    dataBindings = [...bindings];
  }

  dataSql += ' LIMIT ? OFFSET ?';
  dataBindings.push(limit, offset);

  // Use raw D1 for FTS5 + dynamic queries
  const results = await d1.prepare(dataSql).bind(...dataBindings).all<any>().then(r => r.results ?? []);
  const totalRow = await d1.prepare(countSql).bind(...countBindings).first<{ total: number }>();
  const total = totalRow?.total ?? 0;

  // Enrich results with pseuds and tags using Drizzle
  const workIds = results.map((w: any) => w.id);

  if (workIds.length > 0) {
    // Get pseud names via Drizzle
    const pseudRows = await db.select({
      workId: creatorships.workId,
      pseudName: pseuds.name,
    }).from(creatorships)
      .innerJoin(pseuds, eq(pseuds.id, creatorships.pseudId))
      .where(inArray(creatorships.workId, workIds));

    const pseudByWorkId = new Map<number, string>();
    for (const row of pseudRows) {
      if (!pseudByWorkId.has(row.workId)) {
        pseudByWorkId.set(row.workId, row.pseudName);
      }
    }

    // Get tags via Drizzle
    const tagRows = await db.select({
      workId: taggings.workId,
      id: tags.id,
      name: tags.name,
      type: tags.type,
    }).from(taggings)
      .innerJoin(tags, eq(tags.id, taggings.tagId))
      .where(inArray(taggings.workId, workIds));

    const tagsByWorkId = new Map<number, { id: number; name: string; type: string }[]>();
    for (const row of tagRows) {
      const arr = tagsByWorkId.get(row.workId) ?? [];
      arr.push({ id: row.id, name: row.name, type: row.type });
      tagsByWorkId.set(row.workId, arr);
    }

    for (const w of results) {
      w.pseud_name = pseudByWorkId.get(w.id) ?? null;
      w.tags = tagsByWorkId.get(w.id) ?? [];
    }
  } else {
    for (const w of results) {
      w.pseud_name = null;
      w.tags = [];
    }
  }

  return new Response(
    JSON.stringify({ results, total, page }),
    { headers: { 'Content-Type': 'application/json', ...cors } }
  );
};