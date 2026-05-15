export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors, cacheHeaders } from '@/lib/cors';
import type { APIRoute } from 'astro';
import type { EntityType } from '@/lib/types';
import { UserRole, hasRoleLevel } from '@/lib/types';
import { eq, and, sql } from 'drizzle-orm';
import { entityReferences, works, loreEntries, locations as locationTable, characters } from '@/lib/schema';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

const VALID_ENTITY_TYPES: EntityType[] = ['character', 'lore', 'location'];

// GET /api/canon/references — Browse entity references
export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const d1 = locals.runtime.env.DB as D1Database;

  const entityType = url.searchParams.get('entity_type') || '';
  const entityId = url.searchParams.get('entity_id') || '';
  const workId = url.searchParams.get('work_id') || '';

  try {
    // If entity_type + entity_id given, return works referencing the entity
    if (entityType && entityId) {
      const db = getDrizzle(d1);
      const entityWorksResult = await db.execute(sql`
        SELECT w.id, w.title, w.summary, w.word_count, w.published_at, er.entity_type, er.entity_id, er.created_at as reference_created_at
        FROM entity_references er
        JOIN works w ON er.work_id = w.id
        WHERE er.entity_type = ${entityType} AND er.entity_id = ${Number(entityId)}
        ORDER BY w.updated_at DESC
      `);
      const worksList = entityWorksResult.rows;

      return new Response(
        JSON.stringify({ works: worksList }),
        { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } },
      );
    }

    // If work_id given, return entities referenced by the work
    if (workId) {
      const db = getDrizzle(d1);
      const entitiesResult = await db.execute(sql`
        SELECT er.id, er.entity_type, er.entity_id, er.created_at,
               CASE
                 WHEN er.entity_type = 'character' THEN c.name
                 WHEN er.entity_type = 'lore' THEN le.title
                 WHEN er.entity_type = 'location' THEN loc.name
               END as entity_name
        FROM entity_references er
        LEFT JOIN characters c ON er.entity_type = 'character' AND c.id = er.entity_id
        LEFT JOIN lore_entries le ON er.entity_type = 'lore' AND le.id = er.entity_id
        LEFT JOIN locations loc ON er.entity_type = 'location' AND loc.id = er.entity_id
        WHERE er.work_id = ${Number(workId)}
        ORDER BY er.entity_type, er.entity_id
      `);
      const entities = entitiesResult.rows;

      return new Response(
        JSON.stringify({ entities }),
        { headers: { 'Content-Type': 'application/json', ...cors, ...cacheHeaders('public') } },
      );
    }

    // If no filters, return error
    return new Response(
      JSON.stringify({ error: 'Provide entity_type+entity_id or work_id query parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};

// POST /api/canon/references — Create entity reference
export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const cors = corsHeaders(request);
  const auth = await requireAuth(d1, request);
  if (!auth) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const { work_id, entity_type, entity_id } = body || {};
  if (!work_id || !entity_type || !entity_id) {
    return new Response(
      JSON.stringify({ error: 'work_id, entity_type, and entity_id are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  if (!VALID_ENTITY_TYPES.includes(entity_type)) {
    return new Response(
      JSON.stringify({ error: 'Invalid entity_type. Must be character, lore, or location.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const workId = Number(work_id);
  const entityId = Number(entity_id);
  const pseudId = auth.pseuds[0]?.id ?? null;

  try {
    // Validate work exists
    const work = await db.select({ id: works.id }).from(works).where(eq(works.id, workId)).get();
    if (!work) {
      return new Response(
        JSON.stringify({ error: 'Work not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Validate entity exists — use raw SQL for dynamic table name
    const tableName = entity_type === 'lore' ? 'lore_entries' : entity_type === 'location' ? 'locations' : 'characters';
    const entity = await d1.prepare(`SELECT id FROM ${tableName} WHERE id = ?1`).bind(entityId).first<{ id: number }>();
    if (!entity) {
      return new Response(
        JSON.stringify({ error: `${entity_type} with id ${entityId} not found` }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Insert entity_reference
    await db.insert(entityReferences).values({
      workId,
      entityType: entity_type,
      entityId,
    });

    // Get the last inserted reference by querying back
    const ref = await db.select().from(entityReferences)
      .where(and(
        eq(entityReferences.workId, workId),
        eq(entityReferences.entityType, entity_type),
        eq(entityReferences.entityId, entityId),
      ))
      .get();

    // If entity_type is 'character', also upsert into character_appearances
    // for compatibility with the existing character system
    if (entity_type === 'character') {
      try {
        await d1.prepare(
          `INSERT OR IGNORE INTO character_appearances (character_id, work_id, role, notes, added_by)
           VALUES (?1, ?2, 'side', NULL, ?3)`
        ).bind(entityId, workId, pseudId).run();
      } catch {
        // Non-fatal — character_appearances upsert is best-effort
      }
    }

    return new Response(
      JSON.stringify(ref),
      { status: 201, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return new Response(
        JSON.stringify({ error: 'This entity is already referenced by this work' }),
        { status: 409, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};

// DELETE /api/canon/references — Remove entity reference
export const DELETE: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const cors = corsHeaders(request);
  const auth = await requireAuth(d1, request);
  if (!auth) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const { work_id, entity_type, entity_id } = body || {};
  if (!work_id || !entity_type || !entity_id) {
    return new Response(
      JSON.stringify({ error: 'work_id, entity_type, and entity_id are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }

  const workId = Number(work_id);
  const entityId = Number(entity_id);

  try {
    // Find the reference
    const ref = await db.select().from(entityReferences)
      .where(and(
        eq(entityReferences.workId, workId),
        eq(entityReferences.entityType, entity_type),
        eq(entityReferences.entityId, entityId),
      ))
      .get();

    if (!ref) {
      return new Response(
        JSON.stringify({ error: 'Reference not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Permission: work creator or admin/mod
    const isWorkCreator = await d1.prepare(
      `SELECT 1 FROM creatorships c JOIN pseuds p ON c.pseud_id = p.id
       WHERE c.work_id = ?1 AND p.user_id = ?2 LIMIT 1`
    ).bind(workId, auth.user.id).first();
    const isPrivileged = hasRoleLevel(auth.user.role as UserRole, UserRole.Mod);

    if (!isWorkCreator && !isPrivileged) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: must be a work creator or admin/mod' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    await db.delete(entityReferences)
      .where(and(
        eq(entityReferences.workId, workId),
        eq(entityReferences.entityType, entity_type),
        eq(entityReferences.entityId, entityId),
      ));

    // If entity_type is 'character', also clean up character_appearances
    if (entity_type === 'character') {
      try {
        await d1.prepare(
          `DELETE FROM character_appearances WHERE character_id = ?1 AND work_id = ?2`
        ).bind(entityId, workId).run();
      } catch {
        // Non-fatal — character_appearances cleanup is best-effort
      }
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { 'Content-Type': 'application/json', ...cors } },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...cors } },
    );
  }
};