/**
 * Notifications API
 * GET  /api/notifications — List user's notifications (paginated, filterable)
 * DELETE /api/notifications — Delete all or just read notifications
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth } from '@/v2/lib/auth';
import { notifications } from '@/v2/lib/schema/index';
import { eq, and, desc, count } from 'drizzle-orm';

export const GET: APIRoute = async ({ url, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);

  const db = getDb(d1);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const filter = url.searchParams.get('filter'); // 'unread' | 'read' | undefined (all)
  const markRead = url.searchParams.get('markRead') === 'true';

  // Build conditions
  const conditions = [eq(notifications.userId, auth.user.id)];
  if (filter === 'unread') conditions.push(eq(notifications.read, 0));
  if (filter === 'read') conditions.push(eq(notifications.read, 1));

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  // Fetch total count
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(where);

  // Fetch unread count (always, regardless of filter)
  const [{ value: unreadCount }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, auth.user.id), eq(notifications.read, 0)));

  // Fetch page
  const data = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  // Optionally mark returned notifications as read
  if (markRead && data.length > 0) {
    const ids = data.filter((n) => !n.read).map((n) => n.id);
    if (ids.length > 0) {
      // Mark them read one by one (drizzle doesn't have a clean `.whereIn` update)
      for (const id of ids) {
        await db
          .update(notifications)
          .set({ read: 1 })
          .where(eq(notifications.id, id));
      }
    }
  }

  return new Response(
    JSON.stringify({ data, total, unreadCount }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

export const DELETE: APIRoute = async ({ url, locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);

  const db = getDb(d1);
  const readOnly = url.searchParams.get('readOnly') === 'true';

  if (readOnly) {
    // Delete only read notifications
    await db
      .delete(notifications)
      .where(and(eq(notifications.userId, auth.user.id), eq(notifications.read, 1)));
  } else {
    // Delete all notifications for this user
    await db
      .delete(notifications)
      .where(eq(notifications.userId, auth.user.id));
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};