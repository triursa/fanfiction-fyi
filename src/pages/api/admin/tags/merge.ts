export const prerender = false;

import { queryFirst, queryAll, run } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { UserRole } from '@/lib/types';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;

  // Require admin+ role
  const auth = await requireRole(db, request, UserRole.Admin);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  if ('forbidden' in auth) return new Response(JSON.stringify({ error: 'Insufficient role' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { source_id, target_id } = body || {};
  if (!source_id || !target_id) {
    return new Response(JSON.stringify({ error: 'source_id and target_id are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (source_id === target_id) {
    return new Response(JSON.stringify({ error: 'Cannot merge a tag into itself' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify both tags exist
  const sourceTag = await queryFirst<{ id: number; name: string }>(db, `SELECT id, name FROM tags WHERE id = ?1`, source_id);
  if (!sourceTag) {
    return new Response(JSON.stringify({ error: 'Source tag not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  const targetTag = await queryFirst<{ id: number; name: string }>(db, `SELECT id, name FROM tags WHERE id = ?1`, target_id);
  if (!targetTag) {
    return new Response(JSON.stringify({ error: 'Target tag not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Find all taggings for the source tag
  const sourceTaggings = await queryAll<{ work_id: number }>(db, `SELECT work_id FROM taggings WHERE tag_id = ?1`, source_id);
  let moved = 0;
  let duplicates = 0;

  // Move taggings to target, skipping duplicates
  for (const tagging of sourceTaggings) {
    // Check if target already has this work tagged
    const existing = await queryFirst<{ id: number }>(db, `SELECT id FROM taggings WHERE tag_id = ?1 AND work_id = ?2`, target_id, tagging.work_id);
    if (existing) {
      duplicates++;
    } else {
      await run(db, `INSERT INTO taggings (tag_id, work_id) VALUES (?1, ?2)`, target_id, tagging.work_id);
      moved++;
    }
  }

  // Delete source tag (taggings cascade on DELETE)
  await run(db, `DELETE FROM tags WHERE id = ?1`, source_id);

  return new Response(JSON.stringify({
    ok: true,
    moved,
    duplicates,
    deleted_source: sourceTag.name,
    into_target: targetTag.name,
  }), { headers: { 'Content-Type': 'application/json' } });
};