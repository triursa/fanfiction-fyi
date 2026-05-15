export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { series, serialWorks, tags, taggings, pseuds, works, creatorships } from '@/lib/schema';
import { getAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import { eq, and, sql, asc } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

export const GET: APIRoute = async ({ params, locals, request }) => {
  const cors = corsHeaders(request);
  const drz = getDrizzle(locals.runtime.env.DB as D1Database);
  const seriesId = Number(params.id);
  if (!seriesId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Complex JOIN with pseuds — use sql template for API-compatible snake_case output
  const seriesRow = await drz.all<any>(sql`
    SELECT s.*, p.name as creator_name, p.id as creator_pseud_id
     FROM series s JOIN pseuds p ON s.creator_pseud_id = p.id
     WHERE s.id = ${seriesId}
  `);

  if (seriesRow.length === 0) return new Response(JSON.stringify({ error: 'Series not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  const s = seriesRow[0];

  // Get works in order
  const workRows = await drz.all<any>(sql`
    SELECT w.*, sw.position as series_position
     FROM serial_works sw
     JOIN works w ON w.id = sw.work_id
     WHERE sw.series_id = ${seriesId}
     ORDER BY sw.position
  `);

  // Enrich works with tags and pseuds
  for (const w of workRows) {
    w.tags = await drz.all<any>(sql`SELECT t.name, t.type FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ${w.id}`);
    w.pseuds = await drz.all<any>(sql`SELECT p.name, c.role FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ${w.id}`);
  }

  s.works = workRows;

  return new Response(JSON.stringify({ series: s }), { headers: { 'Content-Type': 'application/json', ...cors } });
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const seriesId = Number(params.id);
  if (!seriesId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Check ownership
  const existing = await drz.select().from(series).where(eq(series.id, seriesId)).get();
  if (!existing) return new Response(JSON.stringify({ error: 'Series not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const isOwner = auth.pseuds.some((p: any) => p.id === existing.creatorPseudId);
  if (!isOwner) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { title, description, complete } = body || {};

  // Build update values dynamically
  const updateValues: Record<string, any> = {
    updatedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
  };
  if (title !== undefined) updateValues.title = title;
  if (description !== undefined) updateValues.description = description;
  if (complete !== undefined) updateValues.complete = complete ? 1 : 0;

  if (Object.keys(updateValues).length === 1) {
    // Only updatedAt was set — no actual fields to update
    return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  await drz.update(series).set(updateValues).where(eq(series.id, seriesId));

  const updated = await drz.select().from(series).where(eq(series.id, seriesId)).get();

  // Convert camelCase to snake_case for API compatibility
  const seriesResult = updated ? {
    id: updated.id,
    title: updated.title,
    description: updated.description,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt,
    creator_pseud_id: updated.creatorPseudId,
    complete: updated.complete,
  } : null;

  return new Response(JSON.stringify({ series: seriesResult }), { headers: { 'Content-Type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await getAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const seriesId = Number(params.id);
  if (!seriesId) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const existing = await drz.select().from(series).where(eq(series.id, seriesId)).get();
  if (!existing) return new Response(JSON.stringify({ error: 'Series not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  const isOwner = auth.pseuds.some((p: any) => p.id === existing.creatorPseudId);
  if (!isOwner) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

  // Delete serial_works then series
  await drz.delete(serialWorks).where(eq(serialWorks.seriesId, seriesId));
  await drz.delete(series).where(eq(series.id, seriesId));

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
};