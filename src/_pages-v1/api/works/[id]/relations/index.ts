export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { getAuth, requireAuth } from '@/lib/auth';
import { works, creatorships, pseuds, workRelations } from '@/lib/schema';
import { eq, and, or, like, gt, lt, gte, lte, sql, desc, asc, count, inArray } from 'drizzle-orm';
import type { APIRoute } from 'astro';

const VALID_RELATION_TYPES = ['inspired_by', 'remix_of', 'response_to', 'alternate_pov', 'continuation_of', 'fix_it_for'];

// Inverse relation labels for bidirectional display
const INVERSE_LABELS: Record<string, string> = {
  inspired_by: 'inspired',
  remix_of: 'remixed by',
  response_to: 'responded to by',
  alternate_pov: 'alternate pov of',
  continuation_of: 'continued by',
  fix_it_for: 'fix-it for',
};

export function getInverseLabel(relationType: string): string {
  return INVERSE_LABELS[relationType] || relationType;
}

// GET /api/works/[id]/relations — list all relations (outgoing + incoming) for a work
export const GET: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const work = await db.select({ id: works.id }).from(works).where(eq(works.id, workId)).get();
  if (!work) return new Response(JSON.stringify({ error: 'Work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Outgoing relations: this work → other works
  const outgoingRows = await db
    .select({
      id: workRelations.id,
      workId: workRelations.workId,
      relatedWorkId: workRelations.relatedWorkId,
      relationType: workRelations.relationType,
      createdAt: workRelations.createdAt,
      relatedTitle: works.title,
      relatedWordCount: works.wordCount,
    })
    .from(workRelations)
    .innerJoin(works, eq(works.id, workRelations.relatedWorkId))
    .where(eq(workRelations.workId, workId))
    .orderBy(desc(workRelations.createdAt));

  // Incoming relations: other works → this work
  const incomingRows = await db
    .select({
      id: workRelations.id,
      workId: workRelations.workId,
      relatedWorkId: workRelations.relatedWorkId,
      relationType: workRelations.relationType,
      createdAt: workRelations.createdAt,
      sourceTitle: works.title,
      sourceWordCount: works.wordCount,
    })
    .from(workRelations)
    .innerJoin(works, eq(works.id, workRelations.workId))
    .where(eq(workRelations.relatedWorkId, workId))
    .orderBy(desc(workRelations.createdAt));

  // Format incoming with inverse labels
  const incomingFormatted = incomingRows.map(r => ({
    id: r.id,
    work_id: r.relatedWorkId,
    related_work_id: r.workId,
    relation_type: r.relationType,
    inverse_label: getInverseLabel(r.relationType),
    direction: 'incoming',
    related_title: r.sourceTitle,
    related_word_count: r.sourceWordCount,
    created_at: r.createdAt,
  }));

  // Format outgoing
  const outgoingFormatted = outgoingRows.map(r => ({
    id: r.id,
    work_id: r.workId,
    related_work_id: r.relatedWorkId,
    relation_type: r.relationType,
    direction: 'outgoing',
    related_title: r.relatedTitle,
    related_word_count: r.relatedWordCount,
    created_at: r.createdAt,
  }));

  return new Response(JSON.stringify({ outgoing: outgoingFormatted, incoming: incomingFormatted }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST /api/works/[id]/relations — add a relation (author-only)
export const POST: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { related_work_id, relation_type } = body;
  if (!related_work_id || !relation_type) {
    return new Response(JSON.stringify({ error: 'related_work_id and relation_type are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!VALID_RELATION_TYPES.includes(relation_type)) {
    return new Response(JSON.stringify({ error: `Invalid relation_type. Valid types: ${VALID_RELATION_TYPES.join(', ')}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (Number(related_work_id) === workId) {
    return new Response(JSON.stringify({ error: 'A work cannot relate to itself' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify target work exists
  const targetWork = await db.select({ id: works.id, publishedAt: works.publishedAt }).from(works).where(eq(works.id, related_work_id)).get();
  if (!targetWork) {
    return new Response(JSON.stringify({ error: 'Related work not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  // Verify ownership — user must be an author of the source work
  const userPseudIds = auth.pseuds.map(p => p.id);
  const creatorship = await db
    .select()
    .from(creatorships)
    .where(and(eq(creatorships.workId, workId), inArray(creatorships.pseudId, userPseudIds)))
    .get();
  if (!creatorship) {
    return new Response(JSON.stringify({ error: 'Forbidden — only the author can add relations' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Check for duplicate
  const existing = await db
    .select({ id: workRelations.id })
    .from(workRelations)
    .where(and(eq(workRelations.workId, workId), eq(workRelations.relatedWorkId, related_work_id), eq(workRelations.relationType, relation_type)))
    .get();
  if (existing) {
    return new Response(JSON.stringify({ error: 'This relation already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  // Insert the relation
  const result = await db.insert(workRelations).values({
    workId,
    relatedWorkId: Number(related_work_id),
    relationType: relation_type,
  });

  return new Response(JSON.stringify({
    id: result.meta?.last_row_id ?? result[0]?.meta?.last_row_id,
    work_id: workId,
    related_work_id: Number(related_work_id),
    relation_type,
  }), { status: 201, headers: { 'Content-Type': 'application/json' } });
};