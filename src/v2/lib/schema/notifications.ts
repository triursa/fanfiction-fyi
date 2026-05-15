import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  read: integer('read').notNull().default(0),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
});

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  enabled: integer('enabled').notNull().default(1),
}, (table) => ({
  uniqueUserType: uniqueIndex('idx_v2_notif_pref_user_type').on(table.userId, table.type),
}));

// Indexes
export const idxV2NotificationsUser = index('idx_v2_notifications_user').on(notifications.userId);
