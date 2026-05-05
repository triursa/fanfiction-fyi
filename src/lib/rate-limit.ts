/**
 * Simple rate limiter using D1 for auth endpoints.
 * Tracks failed attempts per key (email or IP) with a sliding window.
 * Designed for a small-scale app (~20 users) — not suitable for high traffic.
 *
 * Gracefully degrades: if the rate_limits table doesn't exist yet
 * (migration 008 not applied), all requests are allowed.
 */

import { getDrizzle } from './db';
import { rateLimits } from './schema';
import { eq, and, gt, lt, sql, count, asc } from 'drizzle-orm';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 300; // 5 minutes

/**
 * Check if a key (email, IP, etc.) is rate-limited.
 * Returns { allowed, retryAfterSeconds, remaining }.
 */
export async function checkRateLimit(
  d1: D1Database,
  key: string,
  action = 'login'
): Promise<RateLimitResult> {
  try {
    const db = getDrizzle(d1);
    const cutoff = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();

    // Clean up expired entries first
    await db.delete(rateLimits).where(lt(rateLimits.createdAt, cutoff));

    // Count recent attempts
    const rows = await db.select({ cnt: count() })
      .from(rateLimits)
      .where(and(eq(rateLimits.key, key), eq(rateLimits.action, action), gt(rateLimits.createdAt, cutoff)));

    const countVal = rows[0]?.cnt ?? 0;
    const remaining = Math.max(0, MAX_ATTEMPTS - countVal);

    if (countVal >= MAX_ATTEMPTS) {
      // Find the oldest attempt in the window to calculate retry-after
      const oldest = await db.select({ createdAt: rateLimits.createdAt })
        .from(rateLimits)
        .where(and(eq(rateLimits.key, key), eq(rateLimits.action, action), gt(rateLimits.createdAt, cutoff)))
        .orderBy(asc(rateLimits.createdAt))
        .limit(1);

      let retryAfter = WINDOW_SECONDS;
      if (oldest[0]?.createdAt) {
        const oldestTime = new Date(oldest[0].createdAt).getTime();
        retryAfter = Math.max(0, Math.ceil((oldestTime + WINDOW_SECONDS * 1000 - Date.now()) / 1000));
      }

      return { allowed: false, retryAfterSeconds: retryAfter, remaining: 0 };
    }

    return { allowed: true, retryAfterSeconds: 0, remaining };
  } catch {
    // If rate_limits table doesn't exist yet, allow all requests (graceful degradation)
    return { allowed: true, retryAfterSeconds: 0, remaining: MAX_ATTEMPTS };
  }
}

/**
 * Record a failed attempt for rate limiting.
 */
export async function recordFailedAttempt(
  d1: D1Database,
  key: string,
  action = 'login'
): Promise<void> {
  try {
    const db = getDrizzle(d1);
    await db.insert(rateLimits).values({
      key,
      action,
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Silently ignore if table doesn't exist
  }
}

/**
 * Clear rate limit entries for a key after a successful action.
 */
export async function clearRateLimit(
  d1: D1Database,
  key: string,
  action = 'login'
): Promise<void> {
  try {
    const db = getDrizzle(d1);
    await db.delete(rateLimits).where(and(eq(rateLimits.key, key), eq(rateLimits.action, action)));
  } catch {
    // Silently ignore if table doesn't exist
  }
}