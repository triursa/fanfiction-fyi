import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const apiKeys = sqliteTable('api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  rateLimitTier: text('rate_limit_tier', { enum: ['free', 'pro'] }).notNull().default('free'),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
  revokedAt: text('revoked_at'),
}, (table) => ({
  userKeyIdx: index('api_keys_user_idx').on(table.userId),
  keyHashIdx: index('api_keys_key_hash_idx').on(table.keyHash),
}));