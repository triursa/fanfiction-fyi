export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth, checkApproved } from '@/lib/auth';
import { annotations, chapters, creatorships, pseuds } from '@/lib/schema';
import { createNotification } from '@/lib/notifications';
import { eq, and, sql } from 'drizzle-orm';
import type { APIRoute } from 'astro';

const VALID_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const;

// GET — not needed (index covers listing). Return 405.
export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
};

// PUT /api/works/[id]/chapters/[chapterId]/annotations/[annotationId]
// Update annotation. Auth + must be owner.
export const PUT: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const annotationId = Number(params.annotationId);
  if (!annotationId) {
    return new Response(JSON.stringify({ error: 'Invalid annotation ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check ownership
  const existing = await db.select().from(annotations)
    .where(eq(annotations.id, annotationId))
    .get();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Annotation not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (existing.userId !== auth.user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const updates: Record<string, any> = {};
  updates.updatedAt = sql`datetime('now')`;

  if (body.note_text !== undefined) {
    updates.noteText = String(body.note_text);
  }
  if (body.color !== undefined) {
    if (!VALID_COLORS.includes(body.color)) {
      return new Response(JSON.stringify({ error: `Invalid color. Must be one of: ${VALID_COLORS.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    updates.color = body.color;
  }
  if (body.shared_with_author !== undefined) {
    updates.sharedWithAuthor = body.shared_with_author ? 1 : 0;
  }

  await db.update(annotations).set(updates).where(eq(annotations.id, annotationId));

  const updated = await db.select().from(annotations)
    .where(eq(annotations.id, annotationId))
    .get();

  return new Response(JSON.stringify({
    id: updated!.id,
    chapterId: updated!.chapterId,
    userId: updated!.userId,
    startOffset: updated!.startOffset,
    endOffset: updated!.endOffset,
    noteText: updated!.noteText,
    color: updated!.color,
    sharedWithAuthor: Boolean(updated!.sharedWithAuthor),
    createdAt: updated!.createdAt,
    updatedAt: updated!.updatedAt,
  }), { headers: { 'Content-Type': 'application/json' } });
};

// PATCH /api/works/[id]/chapters/[chapterId]/annotations/[annotationId]
// Toggle shared_with_author. Auth + must be owner.
export const PATCH: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const annotationId = Number(params.annotationId);
  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!annotationId || !workId || !chapterId) {
    return new Response(JSON.stringify({ error: 'Invalid parameters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check ownership
  const existing = await db.select().from(annotations)
    .where(eq(annotations.id, annotationId))
    .get();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Annotation not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (existing.userId !== auth.user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (body.shared_with_author === undefined || typeof body.shared_with_author !== 'boolean') {
    return new Response(JSON.stringify({ error: 'shared_with_author (boolean) is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const newSharedValue = body.shared_with_author ? 1 : 0;

  await db.update(annotations).set({
    sharedWithAuthor: newSharedValue,
    updatedAt: sql`datetime('now')`,
  }).where(eq(annotations.id, annotationId));

  // If sharing with author for the first time, notify the work author
  if (newSharedValue === 1) {
    // Find the work author's user ID
    const authorRow = await db.select({ userId: pseuds.userId })
      .from(creatorships)
      .innerJoin(pseuds, eq(creatorships.pseudId, pseuds.id))
      .where(eq(creatorships.workId, workId))
      .limit(1)
      .get();

    if (authorRow && authorRow.userId !== auth.user.id) {
      const displayName = auth.user.displayName || 'A reader';
      await createNotification(d1, {
        userId: authorRow.userId,
        type: 'annotation_shared',
        title: 'New annotation shared',
        body: `${displayName} shared an annotation on your work`,
        link: `/works/${workId}/read?chapter=${chapterId}`,
      });
    }
  }

  const updated = await db.select().from(annotations)
    .where(eq(annotations.id, annotationId))
    .get();

  return new Response(JSON.stringify({
    id: updated!.id,
    chapterId: updated!.chapterId,
    userId: updated!.userId,
    startOffset: updated!.startOffset,
    endOffset: updated!.endOffset,
    noteText: updated!.noteText,
    color: updated!.color,
    sharedWithAuthor: Boolean(updated!.sharedWithAuthor),
    createdAt: updated!.createdAt,
    updatedAt: updated!.updatedAt,
  }), { headers: { 'Content-Type': 'application/json' } });
};

// DELETE /api/works/[id]/chapters/[chapterId]/annotations/[annotationId]
// Delete annotation. Auth + must be owner.
export const DELETE: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const annotationId = Number(params.annotationId);
  if (!annotationId) {
    return new Response(JSON.stringify({ error: 'Invalid annotation ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check ownership
  const existing = await db.select().from(annotations)
    .where(eq(annotations.id, annotationId))
    .get();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Annotation not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (existing.userId !== auth.user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await db.delete(annotations).where(eq(annotations.id, annotationId));

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};