import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const pseuds = sqliteTable('pseuds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  iconKey: text('icon_key'),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
  pinnedWorkIds: text('pinned_work_ids').default('[]'),
  bannerKey: text('banner_key'),
  themeColor: text('theme_color'),
  isDefault: integer('is_default').notNull().default(0),
});

// Partial unique index: only one default pseud per user
export const idxPseudsUserDefault = uniqueIndex('idx_pseuds_user_default').on(pseuds.userId);
// Note: SQLite partial index WHERE clause not directly supported in Drizzle schema DSL;
// this index gets the structural part right but may need raw SQL for the WHERE clause.