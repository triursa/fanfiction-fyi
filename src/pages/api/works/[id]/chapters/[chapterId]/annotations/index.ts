export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth, checkApproved } from '@/lib/auth';
import { annotations, chapters } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

const VALID_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const;

function formatAnnotation(a: any) {
  return {
    id: a.id,
    chapterId: a.chapterId,
    userId: a.userId,
    startOffset: a.startOffset,
    endOffset: a.endOffset,
    noteText: a.noteText,
    color: a.color,
    sharedWithAuthor: Boolean(a.sharedWithAuthor),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// GET /api/works/[id]/chapters/[chapterId]/annotations
// List annotations for a chapter. Requires auth.
// Query params: ?shared=1 to also include annotations shared with author.
export const GET: APIRoute = async ({ params, locals, request, url }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const approved = checkApproved(auth);
  if ('forbidden' in approved) {
    return new Response(JSON.stringify({ error: approved.forbidden }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId) {
    return new Response(JSON.stringify({ error: 'Invalid parameters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify chapter belongs to work
  const chapter = await db.select({ id: chapters.id }).from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId)))
    .get();
  if (!chapter) {
    return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const includeShared = url.searchParams.get('shared') === '1';

  // Fetch user's own annotations
  const ownAnnotations = await db.select().from(annotations)
    .where(and(eq(annotations.chapterId, chapterId), eq(annotations.userId, auth.user.id)));

  let allAnnotations = [...ownAnnotations];

  if (includeShared) {
    // Include shared annotations from other users
    const sharedAnnotations = await db.select().from(annotations)
      .where(and(
        eq(annotations.chapterId, chapterId),
        eq(annotations.sharedWithAuthor, 1),
      ));
    // Add only those not already in the list (not owned by current user)
    const ownIds = new Set(ownAnnotations.map(a => a.id));
    for (const a of sharedAnnotations) {
      if (!ownIds.has(a.id)) {
        allAnnotations.push(a);
      }
    }
  }

  return new Response(JSON.stringify(allAnnotations.map(formatAnnotation)), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/works/[id]/chapters/[chapterId]/annotations
// Create a new annotation. Requires auth + approved.
export const POST: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const approved = checkApproved(auth);
  if ('forbidden' in approved) {
    return new Response(JSON.stringify({ error: approved.forbidden }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const workId = Number(params.id);
  const chapterId = Number(params.chapterId);
  if (!workId || !chapterId) {
    return new Response(JSON.stringify({ error: 'Invalid parameters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { start_offset, end_offset, note_text, color, shared_with_author } = body || {};

  // Validate offsets
  if (typeof start_offset !== 'number' || typeof end_offset !== 'number' ||
      !Number.isInteger(start_offset) || !Number.isInteger(end_offset) ||
      start_offset < 0 || end_offset < 0 || start_offset >= end_offset) {
    return new Response(JSON.stringify({ error: 'Invalid offsets. start_offset and end_offset must be non-negative integers with start < end.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Validate color
  if (!color || !VALID_COLORS.includes(color)) {
    return new Response(JSON.stringify({ error: `Invalid color. Must be one of: ${VALID_COLORS.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify chapter belongs to work
  const chapter = await db.select({ id: chapters.id }).from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.workId, workId)))
    .get();
  if (!chapter) {
    return new Response(JSON.stringify({ error: 'Chapter not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const sharedInt = shared_with_author ? 1 : 0;

  const result = await db.insert(annotations).values({
    chapterId,
    userId: auth.user.id,
    startOffset: start_offset,
    endOffset: end_offset,
    noteText: note_text || '',
    color,
    sharedWithAuthor: sharedInt,
  }).returning();

  const a = result[0];
  return new Response(JSON.stringify(formatAnnotation(a)), { status: 201, headers: { 'Content-Type': 'application/json' } });
};