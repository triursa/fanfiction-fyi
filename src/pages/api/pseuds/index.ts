export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { pseuds, creatorships, serialWorks } from '@/lib/schema';
import { getAuth, requireAuth } from '@/lib/auth';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  // Complex JOIN + GROUP BY with two COUNT(DISTINCT) — use sql template for API-compatible output
  const pseudsResult = await drz.all<any>(sql`
    SELECT p.*,
      COUNT(DISTINCT c.work_id) as work_count,
      COUNT(DISTINCT sw.series_id) as series_count
    FROM pseuds p
    LEFT JOIN creatorships c ON c.pseud_id = p.id
    LEFT JOIN serial_works sw ON sw.work_id = c.work_id
    WHERE p.user_id = ${auth.user.id}
    GROUP BY p.id
    ORDER BY p.is_default DESC, p.id
  `);

  return new Response(JSON.stringify(pseudsResult), { headers: { 'Content-Type': 'application/json' } });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const drz = getDrizzle(d1);
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { name, description } = body || {};
  if (!name) {
    return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Validate name length
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName || trimmedName.length > 100) {
    return new Response(JSON.stringify({ error: 'Name must be 1–100 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const existing = await drz.select({ id: pseuds.id })
    .from(pseuds)
    .where(and(eq(pseuds.userId, auth.user.id), eq(pseuds.name, trimmedName)));
  if (existing.length > 0) {
    return new Response(JSON.stringify({ error: 'You already have a pseud with that name' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const desc = (description !== undefined && description !== null) ? String(description) : null;
  const iconKey = (body.icon_key !== undefined && body.icon_key !== null) ? String(body.icon_key) : null;
  const themeColor = (body.theme_color !== undefined && body.theme_color !== null) ? String(body.theme_color) : null;

  // Validate theme_color format (hex color)
  if (themeColor && !/^(?:#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$/.test(themeColor)) {
    return new Response(JSON.stringify({ error: 'Invalid theme color format' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // If this is the user's first pseud, make it default
  const countRow = await drz.select({ cnt: count() })
    .from(pseuds)
    .where(eq(pseuds.userId, auth.user.id))
    .get();
  const isDefault = (countRow?.cnt === 0) ? 1 : 0;

  const [inserted] = await drz.insert(pseuds).values({
    userId: auth.user.id,
    name: trimmedName,
    description: desc,
    iconKey,
    themeColor,
    isDefault,
  }).returning();

  // Convert camelCase to snake_case for API compatibility
  const pseudResult = {
    id: inserted.id,
    user_id: inserted.userId,
    name: inserted.name,
    description: inserted.description,
    icon_key: inserted.iconKey,
    theme_color: inserted.themeColor,
    is_default: inserted.isDefault,
    created_at: inserted.createdAt,
    pinned_work_ids: inserted.pinnedWorkIds,
    banner_key: inserted.bannerKey,
    work_count: 0,
    series_count: 0,
  };

  return new Response(JSON.stringify(pseudResult), { status: 201, headers: { 'Content-Type': 'application/json' } });
};