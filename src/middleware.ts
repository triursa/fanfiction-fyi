/**
 * Middleware — re-exports v2 middleware.
 * Astro requires middleware at src/middleware.ts, so this file
 * simply re-exports the v2 middleware from src/v2/middleware.ts.
 */
export { onRequest } from '@/v2/middleware';