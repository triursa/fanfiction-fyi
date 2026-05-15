export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { notifications } from '@/lib/schema';
import { eq, and, desc, count } from 'drizzle-orm';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 50);
  const offset = (page - 1) * limit;

  const db = getDrizzle(d1);
  const userId = auth.user.id;

  // Get unread count
  const unreadResult = await db.select({ cnt: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
    .get();
  const unreadCount = unreadResult?.cnt ?? 0;

  // Get total count
  const totalResult = await db.select({ cnt: count() })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .get();
  const total = totalResult?.cnt ?? 0;

  // Get notifications for this page
  const notifRows = await db.select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  return new Response(JSON.stringify({
    notifications: notifRows,
    total,
    unreadCount,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Unread-Count': String(unreadCount),
    },
  });
};