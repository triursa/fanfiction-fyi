/**
 * Content Security Policy for fanfiction.fyi.
 *
 * Provides defense-in-depth against XSS even if a sanitization bug slips through.
 * Uses report-only for initial deployment; switch to enforce mode after validation.
 */

export interface CSPOptions {
  reportOnly?: boolean;
}

const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    // Astro inline scripts (theme application, hydration)
    "'unsafe-inline'",
    // Google Fonts stylesheet loader
    'https://fonts.googleapis.com',
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Astro scoped styles + M3 theme overrides
    'https://fonts.googleapis.com',
  ],
  'font-src': [
    "'self'",
    'https://fonts.gstatic.com',
  ],
  'img-src': [
    "'self'",
    'data:', // Inline data URIs (avatars)
    'https://fanfiction.fyi', // R2 storage proxy
    'https://lh3.googleusercontent.com', // Google avatars
  ],
  'connect-src': [
    "'self'", // API calls
    'https://api.github.com', // Bug report endpoint
  ],
  'frame-src': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

function buildCSPHeader(directives: Record<string, string[]>, reportOnly: boolean): [string, string] {
  const value = Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');

  const headerName = reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';

  return [headerName, value];
}

/**
 * Returns CSP headers to add to responses.
 * Starts in report-only mode for safe rollout.
 */
export function cspHeaders(options: CSPOptions = {}): HeadersInit {
  const [name, value] = buildCSPHeader(CSP_DIRECTIVES, options.reportOnly ?? true);
  return { [name]: value };
}