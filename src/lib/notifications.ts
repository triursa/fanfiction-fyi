import { getDrizzle } from './db';
import { notifications, notificationPreferences } from './schema';
import { eq, and } from 'drizzle-orm';

type NotificationType = 'comment_reply' | 'kudos' | 'new_chapter' | 'collection_invite' | 'work_featured' | 'system';

export type { NotificationType };

export async function createNotification(d1: D1Database, params: {
  userId: number;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}): Promise<void> {
  const db = getDrizzle(d1);
  // System notifications always go through; others respect preferences
  if (params.type !== 'system') {
    const pref = await db.select({ enabled: notificationPreferences.enabled })
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, params.userId), eq(notificationPreferences.type, params.type)))
      .get();
    if (pref && !pref.enabled) return; // user opted out
  }
  await db.insert(notifications).values({
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link ?? null,
    read: false,
  });
}