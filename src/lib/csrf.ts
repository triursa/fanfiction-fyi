/**
 * CSRF protection for fanfiction.fyi.
 *
 * Uses the double-submit cookie pattern: a random nonce is generated,
 * stored in a cookie, and must be included in a header for state-changing
 * requests (POST, PUT, DELETE, PATCH).
 *
 * The SameSite=Lax cookie already provides CSRF protection for top-level
 * navigations, but this adds defense-in-depth for same-site AJAX requests
 * and subresource loads.
 */

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32;

/**
 * Generate a random hex token for CSRF protection.
 */
function generateToken(): string {
  const bytes = new Uint8Array(CSRF_TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Set a CSRF token cookie on the response. Called when a user authenticates.
 * Returns Set-Cookie header value.
 */
export function setCsrfCookie(token?: string): string {
  const csrfToken = token || generateToken();
  return `${CSRF_COOKIE_NAME}=${csrfToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`; // 30 days
}

/**
 * Generate a new CSRF token (for login/session creation).
 */
export function generateCsrfToken(): string {
  return generateToken();
}

/**
 * Validate CSRF token for state-changing requests.
 * Compares the csrf_token cookie value with the x-csrf-token header.
 * Returns true if valid, false if missing or mismatched.
 *
 * Note: SameSite=Lax already prevents CSRF from external sites for
 * top-level navigations. This adds protection for AJAX requests
 * from the same origin.
 */
export function validateCsrf(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieMatch = cookieHeader.match(new RegExp(`${CSRF_COOKIE_NAME}=([a-f0-9]+)`));
  const headerToken = request.headers.get(CSRF_HEADER_NAME);

  if (!cookieMatch || !headerToken) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  const cookieToken = cookieMatch[1];
  if (cookieToken.length !== headerToken.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < cookieToken.length; i++) {
    result |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Extract the CSRF cookie value for comparison.
 */
export function getCsrfCookieValue(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`${CSRF_COOKIE_NAME}=([a-f0-9]+)`));
  return match ? match[1] : null;
}