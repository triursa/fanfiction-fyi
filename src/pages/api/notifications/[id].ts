/**
 * Single Notification API
 * PATCH /api/notifications/:id — Mark notification as read/unread
 * DELETE /api/notifications/:id — Delete single notification
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth } from '@/v2/lib/auth';
import { notifications } from '@/v2/lib/schema/index';
import { eq, and } from 'drizzle-orm';

export const PATCH: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);

  const db = getDb(d1);
  const id = Number(params.id);
  if (!id || isNaN(id)) {
    return new Response(
      JSON.stringify({ error: 'Invalid notification ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Ensure the notification belongs to this user
  const existing = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, auth.user.id)))
    .get();

  if (!existing) {
    return new Response(
      JSON.stringify({ error: 'Notification not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const body = await request.json() as { read: boolean };
  if (typeof body.read !== 'boolean') {
    return new Response(
      JSON.stringify({ error: 'read (boolean) required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  await db
    .update(notifications)
    .set({ read: body.read ? 1 : 0 })
    .where(eq(notifications.id, id));

  const updated = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
    .get();

  return new Response(
    JSON.stringify({ data: updated }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

export const DELETE: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);

  const db = getDb(d1);
  const id = Number(params.id);
  if (!id || isNaN(id)) {
    return new Response(
      JSON.stringify({ error: 'Invalid notification ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Ensure the notification belongs to this user
  const existing = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, auth.user.id)))
    .get();

  if (!existing) {
    return new Response(
      JSON.stringify({ error: 'Notification not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  await db
    .delete(notifications)
    .where(eq(notifications.id, id));

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};