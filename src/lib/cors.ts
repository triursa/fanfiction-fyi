/**
 * CORS helpers for the read-only API.
 *
 * - Access-Control-Allow-Origin: value of API_ALLOWED_ORIGIN env var, or "*"
 * - Access-Control-Allow-Methods: GET, OPTIONS
 * - Access-Control-Allow-Headers: Content-Type, Authorization
 */

function getAllowedOrigin(request: Request): string {
  // Prefer runtime env var (Cloudflare Workers), then process.env, then "*"
  const envOrigin =
    (globalThis as any).API_ALLOWED_ORIGIN ??
    (typeof process !== "undefined" && process.env?.API_ALLOWED_ORIGIN) ??
    "*";
  return envOrigin;
}

/** Returns a HeadersInit object with the required CORS headers. */
export function corsHeaders(request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(request),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
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