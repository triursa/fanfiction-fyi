import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const contentReports = sqliteTable('content_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reporterId: integer('reporter_id').references(() => users.id),
  targetType: text('target_type', { enum: ['work', 'comment'] }).notNull(),
  targetId: integer('target_id').notNull(),
  reason: text('reason', { enum: ['harassment', 'spam', 'copyright', 'graphic', 'other'] }).notNull(),
  details: text('details'),
  status: text('status', { enum: ['open', 'resolved', 'dismissed'] }).notNull().default('open'),
  resolverId: integer('resolver_id').references(() => users.id),
  resolution: text('resolution'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at'),
});

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actorId: integer('actor_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: integer('target_id'),
  details: text('details'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
});

// Indexes
export const idxV2ReportsStatus = index('idx_v2_reports_status').on(contentReports.status);
export const idxV2AuditLogActor = index('idx_v2_audit_actor').on(auditLog.actorId);
