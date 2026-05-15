export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { tags, taggings } from '@/lib/schema';
import { requireRole } from '@/lib/auth';
import { UserRole } from '@/lib/types';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);

  // Require admin+ role
  const auth = await requireRole(d1, request, UserRole.Admin);
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
  const sourceTag = await drz.select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.id, source_id))
    .get();
  if (!sourceTag) {
    return new Response(JSON.stringify({ error: 'Source tag not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  const targetTag = await drz.select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.id, target_id))
    .get();
  if (!targetTag) {
    return new Response(JSON.stringify({ error: 'Target tag not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Find all taggings for the source tag
  const sourceTaggings = await drz.select({ workId: taggings.workId })
    .from(taggings)
    .where(eq(taggings.tagId, source_id));
  let moved = 0;
  let duplicates = 0;

  // Move taggings to target, skipping duplicates
  for (const tagging of sourceTaggings) {
    // Check if target already has this work tagged
    const existing = await drz.select({ id: taggings.id })
      .from(taggings)
      .where(and(eq(taggings.tagId, target_id), eq(taggings.workId, tagging.workId)))
      .get();
    if (existing) {
      duplicates++;
    } else {
      await drz.insert(taggings).values({ tagId: target_id, workId: tagging.workId });
      moved++;
    }
  }

  // Delete source tag (taggings cascade on DELETE)
  await drz.delete(tags).where(eq(tags.id, source_id));

  return new Response(JSON.stringify({
    ok: true,
    moved,
    duplicates,
    deleted_source: sourceTag.name,
    into_target: targetTag.name,
  }), { headers: { 'Content-Type': 'application/json' } });
};