export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { notifications } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const PUT: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch { body = {}; }

  const db = getDrizzle(d1);
  const userId = auth.user.id;

  if (body?.id) {
    // Mark a single notification as read (only if it belongs to this user)
    const notif = await db.select().from(notifications).where(and(eq(notifications.id, body.id), eq(notifications.userId, userId))).get();
    if (!notif) {
      return new Response(JSON.stringify({ error: 'Notification not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    await db.update(notifications).set({ read: true }).where(and(eq(notifications.id, body.id), eq(notifications.userId, userId)));
  } else {
    // Mark all notifications as read for this user
    await db.update(notifications).set({ read: true }).where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};