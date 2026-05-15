/**
 * Audit logging helper — inserts entries into the auditLog table.
 *
 * Usage:
 *   import { logAudit } from '@/v2/lib/audit';
 *   await logAudit(d1, actorId, 'user.approve', 'user', targetUserId, { reason: 'met criteria' });
 */
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from './db';
import { auditLog } from './schema/index';

export interface LogAuditOptions {
  details?: Record<string, unknown>;
}

/**
 * Insert an audit log entry.
 */
export async function logAudit(
  d1: D1Database,
  actorId: number,
  action: string,
  targetType: string,
  targetId: number | null,
  options?: LogAuditOptions,
): Promise<void> {
  const db = getDb(d1);
  await db.insert(auditLog).values({
    actorId,
    action,
    targetType,
    targetId,
    details: options?.details ? JSON.stringify(options.details) : null,
  });
}