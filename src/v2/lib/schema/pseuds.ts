import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const pseuds = sqliteTable('pseuds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  iconKey: text('icon_key'),
  bannerKey: text('banner_key'),
  themeColor: text('theme_color'),
  isDefault: integer('is_default').notNull().default(0),
  pinnedWorkIds: text('pinned_work_ids').default('[]'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
});

// Note: partial unique index (one default pseud per user) enforced via raw SQL in migration.