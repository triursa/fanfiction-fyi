export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { works, chapters, creatorships, pseuds, workRelations, readings } from '@/lib/schema';
import { eq, and, sql, isNotNull } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const reading = await db.select().from(readings)
    .where(and(eq(readings.pseudId, pseudId), eq(readings.workId, workId))).get();
  if (!reading) return new Response(JSON.stringify(null), { headers: { 'Content-Type': 'application/json' } });

  return new Response(JSON.stringify(reading), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const lastChapter = body?.last_chapter ?? null;
  const forLater = body?.for_later !== undefined ? (body.for_later ? 1 : 0) : undefined;

  // Upsert: insert or update reading progress
  const existing = await db.select({ id: readings.id }).from(readings)
    .where(and(eq(readings.pseudId, pseudId), eq(readings.workId, workId))).get();

  if (existing) {
    const updateValues: Record<string, any> = { updatedAt: sql`datetime('now')` };
    if (lastChapter !== null) updateValues.lastChapter = lastChapter;
    if (forLater !== undefined) updateValues.forLater = forLater;
    await db.update(readings).set(updateValues).where(eq(readings.id, existing.id));
  } else {
    await db.insert(readings).values({
      pseudId,
      workId,
      forLater: forLater ?? 0,
      lastChapter,
    });
  }

  const reading = await db.select().from(readings)
    .where(and(eq(readings.pseudId, pseudId), eq(readings.workId, workId))).get();
  return new Response(JSON.stringify(reading), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const workId = Number(params.id);
  if (!workId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const pseudId = auth.pseuds[0]?.id;
  if (!pseudId) return new Response(JSON.stringify({ error: 'No pseud found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  await db.delete(readings).where(and(eq(readings.pseudId, pseudId), eq(readings.workId, workId)));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};