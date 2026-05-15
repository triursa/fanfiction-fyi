export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { notifications } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const DELETE: APIRoute = async ({ params, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const notifId = Number(params.id);
  if (!notifId || isNaN(notifId)) {
    return new Response(JSON.stringify({ error: 'Invalid notification ID' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDrizzle(d1);
  const userId = auth.user.id;

  // Only the notification owner can delete
  const notif = await db.select().from(notifications).where(and(eq(notifications.id, notifId), eq(notifications.userId, userId))).get();
  if (!notif) {
    return new Response(JSON.stringify({ error: 'Notification not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  await db.delete(notifications).where(and(eq(notifications.id, notifId), eq(notifications.userId, userId)));

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};