export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { notificationPreferences } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import type { APIRoute } from 'astro';

type NotificationType = 'comment_reply' | 'kudos' | 'new_chapter' | 'collection_invite' | 'work_featured' | 'system';

const ALL_TYPES: NotificationType[] = ['comment_reply', 'kudos', 'new_chapter', 'collection_invite', 'work_featured', 'system'];

export const GET: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  const db = getDrizzle(d1);
  const userId = auth.user.id;

  // Get all preference rows for this user
  const prefs = await db.select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));

  // Build result with defaults for missing types
  const prefMap = new Map(prefs.map(p => [p.type, p.enabled]));
  const result = ALL_TYPES.map(type => ({
    type,
    enabled: prefMap.has(type) ? !!prefMap.get(type) : true,
  }));

  return new Response(JSON.stringify({ preferences: result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

export const PUT: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);
  if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let body: any;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { type, enabled } = body || {};
  if (!type || !ALL_TYPES.includes(type)) {
    return new Response(JSON.stringify({ error: 'Invalid notification type' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (typeof enabled !== 'boolean') {
    return new Response(JSON.stringify({ error: 'enabled must be a boolean' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDrizzle(d1);
  const userId = auth.user.id;

  // Upsert: check if preference exists
  const existing = await db.select()
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.type, type)))
    .get();

  if (existing) {
    await db.update(notificationPreferences)
      .set({ enabled })
      .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.type, type)));
  } else {
    await db.insert(notificationPreferences).values({
      userId,
      type,
      enabled,
    });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};