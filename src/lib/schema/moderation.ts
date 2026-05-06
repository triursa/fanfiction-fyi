import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { users } from './users';
import { works } from './works';

// ─── Content Reports (#90) ─────────────────────────────────────────┐
// Users can report works or comments for harassment, spam, copyright, etc.
export const contentReports = sqliteTable('content_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reporterId: integer('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type', {
    enum: ['work', 'comment'],
  }).notNull(),
  targetId: integer('target_id').notNull(),
  reason: text('reason', {
    enum: ['harassment', 'spam', 'copyright', 'graphic', 'other'],
  }).notNull(),
  details: text('details'),
  status: text('status', {
    enum: ['open', 'resolved', 'dismissed'],
  })
    .notNull()
    .default('open'),
  resolverId: integer('resolver_id').references(() => users.id),
  resolution: text('resolution'),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
  resolvedAt: text('resolved_at'),
});

// ─── Audit Log (#93) ───────────────────────────────────────────────┐
// Logs admin actions for accountability and auditing
export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actorId: integer('actor_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  // Examples: user.ban, user.unban, user.suspend, user.approve, user.revoke,
  //           comment.delete, comment.edit, tag.merge, role.change,
  //           report.resolve, report.dismiss, collection.delete
  targetType: text('target_type', {
    enum: ['user', 'comment', 'tag', 'work', 'report', 'collection'],
  }).notNull(),
  targetId: integer('target_id').notNull(),
  details: text('details'), // JSON blob with action-specific context
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
});

// Indexes
export const idxReportsStatus = index('idx_content_reports_status').on(contentReports.status);
export const idxReportsTarget = index('idx_content_reports_target').on(contentReports.targetType, contentReports.targetId);
export const idxAuditLogAction = index('idx_audit_log_action').on(auditLog.action);
export const idxAuditLogTarget = index('idx_audit_log_target').on(auditLog.targetType, auditLog.targetId);
export const idxAuditLogActor = index('idx_audit_log_actor').on(auditLog.actorId);