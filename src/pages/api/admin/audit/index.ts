/**
 * Admin Audit Log API — Astro-routable copy
 * GET /api/admin/audit — list audit log entries
 * Delegates to v2 implementation via @/v2/ imports.
 */
export { GET } from '@/v2/pages/api/admin/audit/index';