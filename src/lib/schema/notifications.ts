import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['comment_reply', 'kudos', 'new_chapter', 'collection_invite', 'work_featured', 'system', 'annotation_shared'],
  }).notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
}, (table) => ({
  userUnreadIdx: index('notifications_user_unread_idx').on(table.userId, table.read),
}));

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['comment_reply', 'kudos', 'new_chapter', 'collection_invite', 'work_featured', 'system', 'annotation_shared'],
  }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
}, (table) => ({
  userPrefIdx: index('notification_preferences_user_type_idx').on(table.userId, table.type),
}));