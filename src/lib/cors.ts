/**
 * CORS helpers for the read-only API.
 *
 * - Access-Control-Allow-Origin: value of API_ALLOWED_ORIGIN env var,
 *   or the request's Origin header, or fallback to https://fanfiction.fyi
 * - Access-Control-Allow-Methods: GET, OPTIONS
 * - Access-Control-Allow-Headers: Content-Type, Authorization
 *
 * For production, always set API_ALLOWED_ORIGIN to prevent any origin
 * from making credentialed cross-origin requests.
 */

function getAllowedOrigin(request: Request): string {
  // Prefer runtime env var (Cloudflare Workers), then process.env.
  // If neither is set, fall back to the request's Origin header (same-origin
  // requests) rather than "*" which allows any site to call the API with
  // user credentials. For production, always set API_ALLOWED_ORIGIN.
  const envOrigin =
    (globalThis as any).API_ALLOWED_ORIGIN ??
    (typeof process !== "undefined" && process.env?.API_ALLOWED_ORIGIN);
  if (envOrigin) return envOrigin;
  // Mirror the requesting origin (prevents wildcard + credentials)
  const reqOrigin = request.headers.get("Origin");
  return reqOrigin || "https://fanfiction.fyi";
}

/** Returns a HeadersInit object with the required CORS headers. */
export function corsHeaders(request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(request),
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

/**
 * Cache-Control header helpers for API responses.
 *
 * - 'public'  → public, max-age=300 (5 min) — for publicly visible GET endpoints
 * - 'private' → private, no-cache             — for auth-gated endpoints (must revalidate per user)
 * - 'none'    → no-store                       — for frequently changing or sensitive responses
 *
 * NOTE: FTS5 Unicode61 stemmer is NOT supported on Cloudflare D1 — the built-in
 * FTS5 only supports the default and unicode61 tokenizers without custom tokenizers/stemmers.
 * Skip the stemmer item from issue #99.
 */
export function cacheHeaders(
  type: 'public' | 'private' | 'none' = 'none',
): Record<string, string> {
  switch (type) {
    case 'public':
      return { 'Cache-Control': 'public, max-age=300' };
    case 'private':
      return { 'Cache-Control': 'private, no-cache' };
    default:
      return { 'Cache-Control': 'no-store' };
  }
}

/**
 * Handles a CORS preflight (OPTIONS) request.
 * Returns a 204 Response if the request is OPTIONS, or `null` otherwise
 * so the caller can continue with normal request processing.
 */
export function handleCors(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }
  return null;
}