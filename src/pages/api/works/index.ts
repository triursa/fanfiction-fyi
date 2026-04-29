export const prerender = false;

import { queryFirst, run, queryAll } from '@/lib/db';
import { getAuth } from '@/lib/auth';
import { markdownToHtml } from '@/lib/markdown';
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
  const tagType = url.searchParams.get('tag_type');
  const tagName = url.searchParams.get('tag_name');

  let sql = `SELECT w.* FROM works w`;
  const bindings: any[] = [];

  if (tagType || tagName) {
    sql += ` JOIN taggings tg ON tg.work_id = w.id JOIN tags t ON t.id = tg.tag_id WHERE w.published_at IS NOT NULL`;
    if (tagType) { sql += ` AND t.type = ?`; bindings.push(tagType); }
    if (tagName) { sql += ` AND t.name LIKE ?`; bindings.push(`%${tagName}%`); }
  } else {
    sql += ` WHERE w.published_at IS NOT NULL`;
  }

  sql += ` ORDER BY w.updated_at DESC LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const works = await queryAll<any>(db, sql, ...bindings);

  for (const w of works) {
    w.tags = await queryAll<any>(db, `SELECT t.name, t.type FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ?1`, w.id);
    w.pseuds = await queryAll<any>(db, `SELECT p.name, c.role FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ?1`, w.id);
  }

  return new Response(JSON.stringify(works), { headers: { 'Content-Type': 'application/json', ...cors } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await getAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { title, summary, notes, pseud_id, chapter_title, chapter_content, chapter_images, draft, tag_ids, tag_names, rating, category, warning, skip_chapter } = body || {};
  if (!title) return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const pseudId = pseud_id || auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud available' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const isDraft = draft !== undefined ? (draft ? 1 : 0) : 1;
  const skipChapter = skip_chapter === true;

  // Resolve tag_names (new/freeform tags with name+type) to tag_ids
  // This allows users to create new tags during work creation without admin rights
  const resolvedTagIds: number[] = [...(Array.isArray(tag_ids) ? tag_ids.filter((id: any) => typeof id === 'number' && id > 0) : [])];
  
  if (Array.isArray(tag_names)) {
    const validTypes = ['fandom', 'character', 'relationship', 'freeform'];
    for (const tn of tag_names) {
      if (!tn.name || !tn.type || !validTypes.includes(tn.type)) continue;
      // Look up existing tag
      const existing = await queryFirst<any>(db, `SELECT id FROM tags WHERE name = ?1 AND type = ?2`, tn.name, tn.type);
      if (existing) {
        if (!resolvedTagIds.includes(existing.id)) resolvedTagIds.push(existing.id);
      } else {
        // Auto-create the tag
        const tagResult = await run(db, `INSERT OR IGNORE INTO tags (name, type) VALUES (?1, ?2)`, tn.name, tn.type);
        if (tagResult.meta.last_row_id && !resolvedTagIds.includes(tagResult.meta.last_row_id)) {
          resolvedTagIds.push(tagResult.meta.last_row_id);
        } else {
          // INSERT OR IGNORE may not return last_row_id if it was a duplicate — re-fetch
          const reFetched = await queryFirst<any>(db, `SELECT id FROM tags WHERE name = ?1 AND type = ?2`, tn.name, tn.type);
          if (reFetched && !resolvedTagIds.includes(reFetched.id)) resolvedTagIds.push(reFetched.id);
        }
      }
    }
  }

  // Work-level insert (word_count will be 0 if skipping chapter, updated later if chapter included)
  const workResult = await run(db, `INSERT INTO works (title, summary, notes, language, word_count, complete, published_at, updated_at, created_at) VALUES (?1, ?2, ?3, 'en', 0, 0, ${isDraft ? 'NULL' : "CURRENT_TIMESTAMP"}, datetime('now'), datetime('now'))`,
    title, summary || null, notes || null);

  const workId = workResult.meta.last_row_id;

  await run(db, `INSERT INTO creatorships (pseud_id, work_id, role) VALUES (?1, ?2, 'author')`, pseudId, workId);

  let chapterId: number | null = null;

  if (!skipChapter) {
    const contentMd = chapter_content || '';
    const contentHtml = contentMd ? markdownToHtml(contentMd) : null;
    const wordCount = contentMd ? contentMd.split(/\s+/).filter(Boolean).length : 0;

    // Validate chapter_images: must be an array of strings starting with 'chapters/'
    const validImages: string[] = Array.isArray(chapter_images) 
      ? chapter_images.filter((img: string) => typeof img === 'string' && img.startsWith('chapters/') && !img.includes('..'))
      : [];
    const imagesJson = JSON.stringify(validImages);

    const chapterResult = await run(db, `INSERT INTO chapters (work_id, position, title, content_md, content_html, draft, word_count, images, created_at, updated_at) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))`,
      workId, chapter_title || 'Chapter 1', contentMd, contentHtml, isDraft, wordCount, imagesJson);
    chapterId = chapterResult.meta.last_row_id;

    // Update work word_count with chapter's word count
    await run(db, `UPDATE works SET word_count = ?1 WHERE id = ?2`, wordCount, workId);
  }

  // Apply resolved tag IDs
  for (const tagId of resolvedTagIds) {
    await run(db, `INSERT OR IGNORE INTO taggings (tag_id, work_id) VALUES (?1, ?2)`, tagId, workId);
  }

  // Auto-create rating/category/warning tags if provided
  const autoTags = [
    { type: 'rating', name: rating },
    { type: 'category', name: category },
    { type: 'warning', name: warning },
  ].filter(t => t.name);

  for (const t of autoTags) {
    const existing = await queryFirst<any>(db, `SELECT id FROM tags WHERE name = ?1 AND type = ?2`, t.name, t.type);
    if (existing) {
      await run(db, `INSERT OR IGNORE INTO taggings (tag_id, work_id) VALUES (?1, ?2)`, existing.id, workId);
    } else {
      const tagResult = await run(db, `INSERT OR IGNORE INTO tags (name, type) VALUES (?1, ?2)`, t.name, t.type);
      if (tagResult.meta.last_row_id) {
        await run(db, `INSERT OR IGNORE INTO taggings (tag_id, work_id) VALUES (?1, ?2)`, tagResult.meta.last_row_id, workId);
      }
    }
  }

  const work = await queryFirst<any>(db, `SELECT * FROM works WHERE id = ?1`, workId);
  return new Response(JSON.stringify({ work, chapter_id: chapterId }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};