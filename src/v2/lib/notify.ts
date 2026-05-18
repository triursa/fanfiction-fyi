/**
 * Notification helper — sends in-app notifications to users.
 *
 * Checks notificationPreferences for the user+type pair.
 * If no preference row exists, defaults to enabled.
 * Only inserts into the notifications table if enabled.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from './db';
import { notifications, notificationPreferences } from './schema/index';
import { eq, and } from 'drizzle-orm';

export interface NotifyOptions {
  type: string;       // e.g. 'comment.new', 'kudos', 'work.update', 'report.resolved', 'user.approved'
  title: string;
  body: string;
  link?: string;
}

/**
 * Send an in-app notification to a user.
 * Respects their notification preferences — if they've disabled this type, the notification is silently skipped.
 */
export async function notify(
  d1: D1Database,
  userId: number,
  opts: NotifyOptions,
): Promise<void> {
  const db = getDb(d1);

  // Check preference for this user+type
  const pref = await db
    .select({ enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.type, opts.type),
      ),
    )
    .get();

  // If no preference row exists, default to enabled; if a row exists and enabled=0, skip
  if (pref && !pref.enabled) return;

  await db.insert(notifications).values({
    userId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    link: opts.link ?? null,
  });
}