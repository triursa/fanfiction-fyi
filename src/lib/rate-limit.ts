/**
 * Simple rate limiter using D1 for auth endpoints.
 * Tracks failed attempts per key (email or IP) with a sliding window.
 * Designed for a small-scale app (~20 users) — not suitable for high traffic.
 *
 * Gracefully degrades: if the rate_limits table doesn't exist yet
 * (migration 008 not applied), all requests are allowed.
 */

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
  db: D1Database,
  key: string,
  action = 'login'
): Promise<RateLimitResult> {
  try {
    // Clean up expired entries first
    const cutoff = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();
    await db.prepare(`DELETE FROM rate_limits WHERE created_at < ?1`).bind(cutoff).run();

    // Count recent attempts
    const row = await db.prepare(
      `SELECT COUNT(*) as cnt FROM rate_limits WHERE key = ?1 AND action = ?2 AND created_at > ?3`
    ).bind(key, action, cutoff).first<{ cnt: number }>();

    const count = row?.cnt ?? 0;
    const remaining = Math.max(0, MAX_ATTEMPTS - count);

    if (count >= MAX_ATTEMPTS) {
      // Find the oldest attempt in the window to calculate retry-after
      const oldest = await db.prepare(
        `SELECT created_at FROM rate_limits WHERE key = ?1 AND action = ?2 AND created_at > ?3 ORDER BY created_at ASC LIMIT 1`
      ).bind(key, action, cutoff).first<{ created_at: string }>();

      let retryAfter = WINDOW_SECONDS;
      if (oldest?.created_at) {
        const oldestTime = new Date(oldest.created_at).getTime();
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
  db: D1Database,
  key: string,
  action = 'login'
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO rate_limits (key, action, created_at) VALUES (?1, ?2, ?3)`
    ).bind(key, action, new Date().toISOString()).run();
  } catch {
    // Silently ignore if table doesn't exist
  }
}

/**
 * Clear rate limit entries for a key after a successful action.
 */
export async function clearRateLimit(
  db: D1Database,
  key: string,
  action = 'login'
): Promise<void> {
  try {
    await db.prepare(
      `DELETE FROM rate_limits WHERE key = ?1 AND action = ?2`
    ).bind(key, action).run();
  } catch {
    // Silently ignore if table doesn't exist
  }
}