/**
 * Route-level auth guard pattern for fanfiction.fyi v2.
 *
 * Instead of a central isPublicPath() allowlist, each route exports
 * a `config` object that declares its auth level. The middleware
 * reads this config and enforces accordingly.
 *
 * Usage in an Astro page or API route:
 *
 *   export const config = defineRouteConfig('public');   // no auth needed
 *   export const config = defineRouteConfig('optional');  // auth if available
 *   export const config = defineRouteConfig('required');  // must be logged in
 *
 * If no config is exported, the default is 'required' (safe default).
 */

// ─── Types ──────────────────────────────────────────────────

export type AuthLevel = 'public' | 'optional' | 'required';

export interface RouteConfig {
  auth: AuthLevel;
}

// ─── Route config factory ───────────────────────────────────

export function defineRouteConfig(auth: AuthLevel): RouteConfig {
  return { auth };
}

// ─── Helper re-exports for backward compat ──────────────────
// These delegate to the existing auth.ts helpers so route handlers
// can gradually migrate to the new pattern without breaking.

export { getAuth, requireAuth, checkApproved } from './auth';