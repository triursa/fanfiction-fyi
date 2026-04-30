export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { getAuth, requireAuth } from '@/lib/auth';
import { logPublishAttempt, logPublishResult } from '@/lib/publish-logger';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals, request }) => {
  const db = locals.runtime.env.DB as D1Database;
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const work = await queryFirst<any>(db, `SELECT * FROM works WHERE id = ?1`, workId);
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Fetch pseuds first to check ownership
  const pseuds = await queryAll<any>(db, `SELECT p.*, c.role FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ?1`, workId);

  const auth = await getAuth(db, request);
  const isOwner = auth && pseuds.some((p: any) => p.user_id === auth.user.id);

  // Unauthenticated/non-owner users can only see published works
  if (!work.published_at && !isOwner) {
    return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // For owners: show all chapters including drafts. For others: published only, and omit the draft column.
  const chapters = await queryAll<any>(
    db,
    isOwner
      ? `SELECT id, position, title, draft, word_count, updated_at FROM chapters WHERE work_id = ?1 ORDER BY position`
      : `SELECT id, position, title, word_count, updated_at FROM chapters WHERE work_id = ?1 AND draft = 0 ORDER BY position`,
    workId
  );
  const tags = await queryAll<any>(db, `SELECT t.* FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ?1`, workId);

  return new Response(JSON.stringify({ work, chapters, tags, pseuds }), { headers: { 'Content-Type': 'application/json' } });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const creatorship = await queryFirst<any>(db, `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)`, workId, auth.user.id);
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  let workLogId: number = 0;
  if (body.publish) {
    workLogId = await logPublishAttempt(db, { workId, step: 'work_publish', userId: auth.user.id, requestSummary: JSON.stringify({ publish: true }) });
  }

  try {

  // Handle tag updates: resolve tag_names + tag_ids, then clear and re-add
  const resolvedTagIds: number[] = [...(Array.isArray(body.tag_ids) ? body.tag_ids.filter((id: any) => typeof id === 'number' && id > 0) : [])];
  
  if (Array.isArray(body.tag_names)) {
    const validTypes = ['fandom', 'character', 'relationship', 'freeform'];
    for (const tn of body.tag_names) {
      if (!tn.name || !tn.type || !validTypes.includes(tn.type)) continue;
      const existing = await queryFirst<any>(db, `SELECT id FROM tags WHERE name = ?1 AND type = ?2`, tn.name, tn.type);
      if (existing) {
        if (!resolvedTagIds.includes(existing.id)) resolvedTagIds.push(existing.id);
      } else {
        const tagResult = await run(db, `INSERT OR IGNORE INTO tags (name, type) VALUES (?1, ?2)`, tn.name, tn.type);
        if (tagResult.meta.last_row_id && !resolvedTagIds.includes(tagResult.meta.last_row_id)) {
          resolvedTagIds.push(tagResult.meta.last_row_id);
        } else {
          const reFetched = await queryFirst<any>(db, `SELECT id FROM tags WHERE name = ?1 AND type = ?2`, tn.name, tn.type);
          if (reFetched && !resolvedTagIds.includes(reFetched.id)) resolvedTagIds.push(reFetched.id);
        }
      }
    }
  }

  if (resolvedTagIds.length > 0 || Array.isArray(body.tag_ids) || Array.isArray(body.tag_names)) {
    await run(db, `DELETE FROM taggings WHERE work_id = ?1`, workId);
    for (const tagId of resolvedTagIds) {
      await run(db, `INSERT OR IGNORE INTO taggings (tag_id, work_id) VALUES (?1, ?2)`, tagId, workId);
    }
  }

  // Handle auto-create rating/category/warning tags
  const autoTags = [
    { type: 'rating', name: body.rating },
    { type: 'category', name: body.category },
    { type: 'warning', name: body.warning },
  ].filter(t => t.name);

  for (const t of autoTags) {
    // Remove existing tags of this type for the work
    await run(db, `DELETE FROM taggings WHERE work_id = ?1 AND tag_id IN (SELECT id FROM tags WHERE type = ?2)`, workId, t.type);
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

  const fields: string[] = [];
  const values: any[] = [];
  if (body.title !== undefined) { fields.push('title = ?'); values.push(body.title); }
  if (body.summary !== undefined) { fields.push('summary = ?'); values.push(body.summary); }
  if (body.notes !== undefined) { fields.push('notes = ?'); values.push(body.notes); }
  if (body.end_notes !== undefined) { fields.push('end_notes = ?'); values.push(body.end_notes); }
  if (body.complete !== undefined) { fields.push('complete = ?'); values.push(body.complete ? 1 : 0); }
  if (body.language !== undefined) { fields.push('language = ?'); values.push(body.language); }
  if (body.publish) {
    console.log('[WORK_PUT] Publishing work:', workId, 'body keys:', Object.keys(body).join(','));
    // Set published_at only if it's currently null (first publish)
    fields.push("published_at = COALESCE(published_at, CURRENT_TIMESTAMP)");
  }

  if (fields.length === 0 && !Array.isArray(body.tag_ids) && autoTags.length === 0) return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(workId);
    await run(db, `UPDATE works SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }

  // When publishing, also publish all draft chapters
  if (body.publish) {
    await run(db, `UPDATE chapters SET draft = 0, updated_at = datetime('now') WHERE work_id = ?1 AND draft = 1`, workId);
    await run(db, `UPDATE works SET word_count = (SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE work_id = ?1 AND draft = 0) WHERE id = ?1`, workId);
  }

  const work = await queryFirst<any>(db, `SELECT * FROM works WHERE id = ?1`, workId);

  // Log publish result after fetching the updated work so we can include published_at
  if (body.publish && workLogId) {
    await logPublishResult(db, workLogId, { status: 'success', httpStatus: 200, responseSummary: JSON.stringify({ published_at: work?.published_at }).slice(0,200) });
  }

  return new Response(JSON.stringify(work), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[WORK_PUT] Error updating work:', workId, err);
    if (workLogId) await logPublishResult(db, workLogId, { status: 'fail', httpStatus: 500, error: String(err?.message || err) });
    return new Response(JSON.stringify({ error: err?.message || 'Internal server error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(db, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const creatorship = await queryFirst<any>(db, `SELECT * FROM creatorships WHERE work_id = ?1 AND pseud_id IN (SELECT id FROM pseuds WHERE user_id = ?2)`, workId, auth.user.id);
  if (!creatorship) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  await run(db, `DELETE FROM works WHERE id = ?1`, workId);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};