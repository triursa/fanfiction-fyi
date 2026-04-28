/**
 * CORS helpers for the read-only API.
 *
 * - Access-Control-Allow-Origin: value of API_ALLOWED_ORIGIN env var, or "*"
 * - Access-Control-Allow-Methods: GET, OPTIONS
 * - Access-Control-Allow-Headers: Content-Type, Authorization
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