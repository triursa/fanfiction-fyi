/**
 * v2 CORS helpers for API responses.
 *
 * The middleware handles CORS preflight (OPTIONS) and adds headers to responses.
 * These helpers are for edge cases where you need to add CORS manually.
 */

export const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
} as const;

/**
 * Get the appropriate CORS origin header value.
 * v2 allows: fanfiction.fyi, staging.fanfiction.fyi, localhost:4321
 */
export function corsOrigin(request: Request): string {
  const origin = request.headers.get('Origin');
  if (!origin) return '*';

  const allowedHosts = ['fanfiction.fyi', 'staging.fanfiction.fyi', 'localhost:4321'];
  try {
    const url = new URL(origin);
    if (allowedHosts.some(host => url.host === host)) {
      return origin;
    }
  } catch { /* invalid origin */ }
  return 'https://fanfiction.fyi';
}