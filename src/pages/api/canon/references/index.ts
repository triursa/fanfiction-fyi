export const prerender = false;

import { queryAll, queryFirst, run } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { corsHeaders, handleCors } from '@/lib/cors';
import type { APIRoute } from 'astro';
import type { EntityType } from '@/lib/types';
import { UserRole, hasRoleLevel } from '@/lib/types';

export const OPTIONS: APIRoute = async ({ request }) => {
  return handleCors(request) ?? new Response(null, { status: 405 });
};

const VALID_ENTITY_TYPES: EntityType[] = ['character', 'lore', 'location'];

const ENTITY_TABLE_MAP: Record<EntityType, string> = {
  character: 'characters',
  lore: 'lore_entries',
  location: 'locations',
};

// GET /api/canon/references — Browse entity references
export const GET: APIRoute = async ({ url, locals, request }) => {
  const cors = corsHeaders(request);
  const db = locals.runtime.env.DB as D1Database;

  const entityType = url.searchParams.get('entity_type') || '';
  const entityId = url.searchParams.get('entity_id') || '';
  const workId = url.searchParams.get('work_id') || '';

  try {
    // If entity_type + entity_id given, return works referencing the entity
    if (entityType && entityId) {
      const works = await queryAll<any>(
        db,
        `SELECT w.id, w.title, w.summary, w.word_count, w.published_at, er.entity_type, er.entity_id, er.created_at as reference_created_at
         FROM entity_references er
         JOIN works w ON er.work_id = w.id
         WHERE er.entity_type = ?1 AND er.entity_id = ?2
         ORDER BY w.updated_at DESC`,
        entityType, Number(entityId),
      );
      return new Response(
        JSON.stringify({ works }),
        { headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // If work_id given, return entities referenced by the work
    if (workId) {
      const entities = await queryAll<any>(
        db,
        `SELECT er.id, er.entity_type, er.entity_id, er.created_at,
                CASE
                  WHEN er.entity_type = 'character' THEN c.name
                  WHEN er.entity_type = 'lore' THEN le.title
                  WHEN er.entity_type = 'location' THEN loc.name
                END as entity_name
         FROM entity_references er
         LEFT JOIN characters c ON er.entity_type = 'character' AND c.id = er.entity_id
         LEFT JOIN lore_entries le ON er.entity_type = 'lore' AND le.id = er.entity_id
         LEFT JOIN locations loc ON er.entity_type = 'location' AND loc.id = er.entity_id
         WHERE er.work_id = ?1
         ORDER BY er.entity_type, er.entity_id`,
        Number(workId),
      );
      return new Response(
        JSON.stringify({ entities }),
        { headers: { 'Content-Type': 'application/json', ...cors } },
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
  const db = locals.runtime.env.DB as D1Database;
  const cors = corsHeaders(request);
  const auth = await requireAuth(db, request);
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
    const work = await queryFirst<any>(db, `SELECT id FROM works WHERE id = ?1`, workId);
    if (!work) {
      return new Response(
        JSON.stringify({ error: 'Work not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Validate entity exists
    const tableName = ENTITY_TABLE_MAP[entity_type];
    const entity = await queryFirst<any>(
      db,
      `SELECT id FROM ${tableName} WHERE id = ?1`,
      entityId,
    );
    if (!entity) {
      return new Response(
        JSON.stringify({ error: `${entity_type} with id ${entityId} not found` }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Insert entity_reference (handle UNIQUE constraint)
    const result = await run(
      db,
      `INSERT INTO entity_references (work_id, entity_type, entity_id) VALUES (?1, ?2, ?3)`,
      workId, entity_type, entityId,
    );

    const reference = await queryFirst<any>(
      db,
      `SELECT * FROM entity_references WHERE id = ?1`,
      result.meta.last_row_id,
    );

    // If entity_type is 'character', also upsert into character_appearances
    // for compatibility with the existing character system
    if (entity_type === 'character') {
      try {
        await run(
          db,
          `INSERT OR IGNORE INTO character_appearances (character_id, work_id, role, notes, added_by)
           VALUES (?1, ?2, 'side', NULL, ?3)`,
          entityId, workId, pseudId,
        );
      } catch {
        // Non-fatal — character_appearances upsert is best-effort
      }
    }

    return new Response(
      JSON.stringify(reference),
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
  const db = locals.runtime.env.DB as D1Database;
  const cors = corsHeaders(request);
  const auth = await requireAuth(db, request);
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
    const ref = await queryFirst<any>(
      db,
      `SELECT * FROM entity_references WHERE work_id = ?1 AND entity_type = ?2 AND entity_id = ?3`,
      workId, entity_type, entityId,
    );
    if (!ref) {
      return new Response(
        JSON.stringify({ error: 'Reference not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    // Permission: work creator (adder) or admin/mod
    const isWorkCreator = await queryFirst<any>(
      db,
      `SELECT 1 FROM creatorships c JOIN pseuds p ON c.pseud_id = p.id
       WHERE c.work_id = ?1 AND p.user_id = ?2 LIMIT 1`,
      workId, auth.user.id,
    );
    const isPrivileged = hasRoleLevel(auth.user.role as UserRole, UserRole.Mod);

    if (!isWorkCreator && !isPrivileged) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: must be a work creator or admin/mod' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...cors } },
      );
    }

    await run(
      db,
      `DELETE FROM entity_references WHERE work_id = ?1 AND entity_type = ?2 AND entity_id = ?3`,
      workId, entity_type, entityId,
    );

    // If entity_type is 'character', also clean up character_appearances
    if (entity_type === 'character') {
      try {
        await run(
          db,
          `DELETE FROM character_appearances WHERE character_id = ?1 AND work_id = ?2`,
          entityId,
          workId,
        );
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
