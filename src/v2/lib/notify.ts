/**
 * Notification helper — sends in-app notifications to users,
 * and optionally sends email for high-priority notification types.
 *
 * Checks notificationPreferences for the user+type pair.
 * If no preference row exists, defaults to enabled.
 * Only inserts into the notifications table if enabled.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from './db';
import { notifications, notificationPreferences } from './schema/index';
import { eq, and } from 'drizzle-orm';
import { sendNotificationEmail } from './email';

export interface NotifyOptions {
  type: string;       // e.g. 'comment.new', 'kudos', 'work.update', 'report.resolved', 'user.approved'
  title: string;
  body: string;
  link?: string;
  /** Email address for sending an email notification. If omitted, only in-app notification is created. */
  email?: string;
  /** Resend API key from the runtime env. Required if email is provided. */
  resendApiKey?: string;
}

/**
 * Send an in-app notification to a user.
 * Respects their notification preferences — if they've disabled this type, the notification is silently skipped.
 * If an email address is provided, also sends an email notification (best-effort, won't block the in-app notification).
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

  // Send email notification if an address was provided (best-effort, don't block)
  if (opts.email) {
    try {
      await sendNotificationEmail(opts.resendApiKey, opts.email, {
        title: opts.title,
        body: opts.body,
        link: opts.link,
      });
    } catch (err) {
      // Don't let email failures break the in-app notification
      console.error(`[NOTIFY] Failed to send email to ${opts.email}:`, err);
    }
  }
}