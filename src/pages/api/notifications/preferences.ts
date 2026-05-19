/**
 * Notification Preferences API
 * GET  /api/notifications/preferences — List all notification types with enabled status
 * PUT  /api/notifications/preferences — Update preferences
 */
import type { APIRoute } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '@/v2/lib/db';
import { requireAuth } from '@/v2/lib/auth';
import { notificationPreferences } from '@/v2/lib/schema/index';
import { eq } from 'drizzle-orm';

// Canonical notification types in the system
const NOTIFICATION_TYPES = [
  'comment.new',
  'comment.reply',
  'kudos',
  'work.update',
  'report.resolved',
  'user.signup',
  'user.approved',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const GET: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);

  const db = getDb(d1);

  // Get all saved preferences for this user
  const saved = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, auth.user.id));

  const prefMap = new Map(saved.map((p) => [p.type, p.enabled]));

  // Merge with canonical types — default enabled if no row exists
  const preferences = NOTIFICATION_TYPES.map((type) => ({
    type,
    enabled: prefMap.has(type) ? !!prefMap.get(type) : true,
  }));

  return new Response(
    JSON.stringify({ data: preferences }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

export const PUT: APIRoute = async ({ locals, request }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const auth = await requireAuth(d1, request);

  const db = getDb(d1);
  const body = await request.json() as { preferences: Array<{ type: string; enabled: boolean }> };

  if (!Array.isArray(body.preferences)) {
    return new Response(
      JSON.stringify({ error: 'preferences array required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  for (const pref of body.preferences) {
    if (!pref.type || typeof pref.enabled !== 'boolean') continue;

    // Upsert preference using onConflictDoUpdate (INSERT OR REPLACE)
    await db.insert(notificationPreferences).values({
      userId: auth.user.id,
      type: pref.type,
      enabled: pref.enabled ? 1 : 0,
    }).onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.type],
      set: { enabled: pref.enabled ? 1 : 0 },
    });
  }

  // Return updated preferences
  return GET({ locals, request } as any);
};