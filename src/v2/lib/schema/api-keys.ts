import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const apiKeys = sqliteTable('api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  rateLimitTier: text('rate_limit_tier', { enum: ['free', 'pro'] }).notNull().default('free'),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  revokedAt: text('revoked_at'),
});

// Indexes
export const idxV2ApiKeyHash = uniqueIndex('idx_v2_api_key_hash').on(apiKeys.keyHash);
