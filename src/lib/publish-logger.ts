/**
 * Publish Logger — D1-backed persistent logging for the publish flow.
 * 
 * Records every publish attempt (chapter save + work publish) with:
 * - Step identifier (chapter_save | work_publish)
 * - Status (attempt → success | fail)
 * - HTTP status code, error message, user/work/chapter IDs
 * - Request/response summaries (truncated for D1 safety)
 * 
 * Usage in API handlers:
 *   import { logPublishAttempt, logPublishResult } from '@/lib/publish-logger';
 *   const logId = await logPublishAttempt(db, { workId, chapterId, step, userId, requestSummary });
 *   // ... do the work ...
 *   await logPublishResult(db, logId, { status: 'success', httpStatus: 200 });
 *   // or on error:
 *   await logPublishResult(db, logId, { status: 'fail', httpStatus: 500, error: err.message });
 */

export interface PublishLogEntry {
  id?: number;
  work_id: number;
  chapter_id?: number | null;
  step: 'chapter_save' | 'work_publish' | 'chapter_publish_post';
  status: 'attempt' | 'success' | 'fail';
  http_status?: number | null;
  error?: string | null;
  user_id?: number | null;
  request_summary?: string | null;
  response_summary?: string | null;
  created_at?: string;
}

/**
 * Log a publish attempt (before the operation executes).
 * Returns the log entry ID for later update with logPublishResult().
 */
export async function logPublishAttempt(
  db: D1Database,
  entry: {
    workId: number;
    chapterId?: number | null;
    step: PublishLogEntry['step'];
    userId?: number | null;
    requestSummary?: string;
  }
): Promise<number> {
  try {
    const result = await db.prepare(
      `INSERT INTO publish_log (work_id, chapter_id, step, status, user_id, request_summary, created_at)
       VALUES (?1, ?2, ?3, 'attempt', ?4, ?5, CURRENT_TIMESTAMP)`
    )
      .bind(
        entry.workId,
        entry.chapterId ?? null,
        entry.step,
        entry.userId ?? null,
        truncate(entry.requestSummary, 500)
      )
      .run();

    return result.meta.last_row_id ?? 0;
  } catch {
    // Logger must never break the publish flow — swallow errors
    console.error('[publish-logger] Failed to log attempt');
    return 0;
  }
}

/**
 * Update a log entry with the result (success or failure).
 */
export async function logPublishResult(
  db: D1Database,
  logId: number,
  result: {
    status: 'success' | 'fail';
    httpStatus?: number;
    error?: string;
    responseSummary?: string;
  }
): Promise<void> {
  if (!logId) return; // Entry was never created
  try {
    await db.prepare(
      `UPDATE publish_log SET status = ?1, http_status = ?2, error = ?3, response_summary = ?4
       WHERE id = ?5`
    )
      .bind(
        result.status,
        result.httpStatus ?? null,
        truncate(result.error, 500) ?? null,
        truncate(result.responseSummary, 500) ?? null,
        logId
      )
      .run();
  } catch {
    console.error('[publish-logger] Failed to log result');
  }
}

/**
 * Convenience: log attempt + execute + log result in one wrapper.
 * Use this to wrap any async publish operation.
 */
export async function withPublishLog<T>(
  db: D1Database,
  entry: {
    workId: number;
    chapterId?: number | null;
    step: PublishLogEntry['step'];
    userId?: number | null;
    requestSummary?: string;
  },
  fn: () => Promise<{ status: number; body: T; error?: string }>
): Promise<{ status: number; body: T; error?: string }> {
  const logId = await logPublishAttempt(db, entry);
  try {
    const result = await fn();
    await logPublishResult(db, logId, {
      status: 'success',
      httpStatus: result.status,
      responseSummary: JSON.stringify(result.body).slice(0, 500),
    });
    return result;
  } catch (err: any) {
    await logPublishResult(db, logId, {
      status: 'fail',
      httpStatus: 500,
      error: err?.message || String(err),
    });
    throw err;
  }
}

function truncate(str: string | undefined | null, max: number): string | undefined {
  if (!str) return undefined;
  return str.length > max ? str.slice(0, max) + '…' : str;
}