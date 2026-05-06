/**
 * Audit logging utility for admin actions.
 * Logs all significant admin/moderator actions to the audit_log table.
 *
 * Usage:
 *   import { logAudit } from '@/lib/audit';
 *   await logAudit(d1, actorId, 'user.ban', 'user', userId, { reason: 'spam' });
 */
import { getDrizzle } from './db';
import { auditLog } from './schema';

export type AuditAction =
  | 'user.ban'
  | 'user.unban'
  | 'user.approve'
  | 'user.revoke'
  | 'user.suspend'
  | 'user.unsuspend'
  | 'user.role_change'
  | 'comment.delete'
  | 'comment.edit'
  | 'tag.merge'
  | 'report.resolve'
  | 'report.dismiss'
  | 'collection.delete'
  | 'work.delete';

export type AuditTargetType = 'user' | 'comment' | 'tag' | 'work' | 'report' | 'collection';

export async function logAudit(
  d1: D1Database,
  actorId: number,
  action: AuditAction,
  targetType: AuditTargetType,
  targetId: number,
  details?: Record<string, unknown>,
): Promise<void> {
  const db = getDrizzle(d1);
  await db.insert(auditLog).values({
    actorId,
    action,
    targetType,
    targetId,
    details: details ? JSON.stringify(details) : null,
  });
}