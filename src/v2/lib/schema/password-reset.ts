import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const passwordResets = sqliteTable('password_resets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),  // ISO timestamp
  usedAt: text('used_at'),  // null until used
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// Indexes
export const idxPasswordResetsToken = uniqueIndex('idx_v2_password_resets_token').on(passwordResets.token);
export const idxPasswordResetsUser = index('idx_v2_password_resets_user').on(passwordResets.userId);