import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['founder', 'admin', 'mod', 'user'] }).notNull().default('user'),
  displayName: text('display_name'),
  avatarKey: text('avatar_key'),
  bio: text('bio').default(''),
  emailVisibility: text('email_visibility', { enum: ['public', 'mutual', 'private'] }).notNull().default('private'),
  readingFontSize: text('reading_font_size', { enum: ['small', 'default', 'large', 'xlarge'] }).notNull().default('default'),
  readingSkinOverride: text('reading_skin_override', { enum: ['author', 'default', 'typewriter', 'manuscript', 'terminal', 'parchment'] }).notNull().default('author'),
  theme: text('theme').default('obsidian'),
  approved: integer('approved').notNull().default(1),
  banned: integer('banned').notNull().default(0),
  suspendedUntil: text('suspended_until'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});

export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  expiresAt: text('expires_at').notNull(),
});

export const inviteCodes = sqliteTable('invite_codes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  createdById: integer('created_by_id').references(() => users.id),
  usedBy: integer('used_by').references(() => users.id),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  usedAt: text('used_at'),
});

// Indexes
export const idxSessionsToken = uniqueIndex('idx_v2_sessions_token').on(sessions.token);
export const idxSessionsUser = index('idx_v2_sessions_user').on(sessions.userId);