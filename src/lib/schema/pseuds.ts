import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
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

// Note: the partial unique index `CREATE UNIQUE INDEX idx_pseuds_user_default ON pseuds(user_id)
// WHERE is_default = 1` cannot be expressed in Drizzle's schema DSL — it is enforced via the
// raw SQL statement in the migration file (drizzle/0000_tiny_black_tom.sql).