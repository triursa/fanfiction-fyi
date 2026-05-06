import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  role: text('role', {
    enum: ['founder', 'admin', 'mod', 'user'],
  })
    .notNull()
    .default('user'),
  googleId: text('google_id'),
  avatarUrl: text('avatar_url'),
  avatarKey: text('avatar_key'),
  displayName: text('display_name'),
  inviteCode: text('invite_code'),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
  updatedAt: text('updated_at').notNull().default('(datetime(\'now\'))'),
  banned: integer('banned').notNull().default(0),
  suspendedUntil: text('suspended_until'), // Unix timestamp or ISO datetime for temp suspension (#91)
  theme: text('theme').default('obsidian'),
  bio: text('bio').default(''),
  emailVisibility: text('email_visibility', {
    enum: ['public', 'mutual', 'private'],
  })
    .notNull()
    .default('private'),
  readingFontSize: text('reading_font_size', {
    enum: ['small', 'default', 'large', 'xlarge'],
  })
    .notNull()
    .default('default'),
  moodDisabled: integer('mood_disabled').default(0),
  approved: integer('approved').notNull().default(1),
});

export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
  expiresAt: text('expires_at').notNull(),
});

export const inviteCodes = sqliteTable('invite_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  usedBy: integer('used_by').references(() => users.id),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
  usedAt: text('used_at'),
});

export const oauthStates = sqliteTable('oauth_states', {
  state: text('state').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const rateLimits = sqliteTable('rate_limits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  action: text('action').notNull().default('login'),
  createdAt: text('created_at').notNull(),
});

// Indexes
export const idxUsersEmail = uniqueIndex('idx_users_email').on(users.email);
export const idxUsersGoogleId = index('idx_users_google_id').on(users.googleId);
export const idxSessionsToken = uniqueIndex('idx_sessions_token').on(sessions.token);
export const idxSessionsUser = index('idx_sessions_user').on(sessions.userId);
export const idxRateLimitsKeyAction = index('idx_rate_limits_key_action').on(rateLimits.key, rateLimits.action);
export const idxRateLimitsCreated = index('idx_rate_limits_created').on(rateLimits.createdAt);
export const idxOauthStatesUser = index('idx_oauth_states_user').on(oauthStates.userId);
export const idxOauthStatesCreated = index('idx_oauth_states_created').on(oauthStates.createdAt);