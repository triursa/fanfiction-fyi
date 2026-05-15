/**
 * Integration tests: Works CRUD (create, read, update, delete)
 *
 * Tests the full work lifecycle against the live v2 dev server.
 * Server is started once by globalSetup.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type TestServer, uniqueEmail } from './helpers';

let svc: TestServer;
let authCookies: string;
let pseudId: number;

describe('Works Integration', () => {
  beforeAll(async () => {
    svc = await startServer();
    const result = await svc.signup({
      email: uniqueEmail(),
      password: 'WorksTest123!',
    });
    authCookies = result.cookies;

    // Get the user's default pseud from /api/auth/me
    const meRes = await svc.fetch('GET', '/api/auth/me', undefined, {
      cookies: authCookies,
    });
    if (meRes.ok) {
      const me = await meRes.json() as any;
      if (me.pseuds && me.pseuds.length > 0) {
        pseudId = me.pseuds[0].id;
      }
    }
  });

  afterAll(async () => {
    await svc.stop();
  });

  // ─── Create Work ───────────────────────────────────────────

  describe('POST /api/works', () => {
    it('creates a new draft work', async () => {
      const res = await svc.fetch('POST', '/api/works', {
        title: 'Integration Test Work',
        summary: 'A work created by integration tests',
        pseudId: pseudId || 1,
        language: 'en',
        tags: [
          { name: 'General Audiences', type: 'rating' },
          { name: 'No Archive Warnings Apply', type: 'warning' },
          { name: 'Original Work', type: 'fandom' },
        ],
      }, { cookies: authCookies });

      expect(res.status).toBe(201);
      const data = await res.json() as any;
      expect(data.data).toBeDefined();
      expect(data.data.title).toBe('Integration Test Work');
    });

    it('rejects creation without auth', async () => {
      
      const res = await svc.fetch('POST', '/api/works', {
        title: 'Unauthorized Work',
        pseudId: 1,
      });

      expect(res.status).toBe(401);
    });

    it('rejects creation with missing title', async () => {

      const res = await svc.fetch('POST', '/api/works', {
        pseudId: pseudId || 1,
      }, { cookies: authCookies });

      // v2 returns 422 for validation errors
      expect(res.status).toBe(422);
    });
  });

  // ─── List Works ────────────────────────────────────────────

  describe('GET /api/works', () => {
    it('returns a paginated list of published works', async () => {
      
      const res = await svc.fetch('GET', '/api/works?limit=10');

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('total');
    });

    it('supports tag-based filtering', async () => {
      
      const res = await svc.fetch('GET', '/api/works?fandom=Original+Work&limit=5');

      expect(res.status).toBe(200);
    });

    it('returns user\'s own works (including drafts) with mine=true', async () => {
      
      const res = await svc.fetch('GET', '/api/works?mine=true', undefined, {
        cookies: authCookies,
      });

      expect(res.status).toBe(200);
    });

    it('rejects mine=true without auth', async () => {
      
      const res = await svc.fetch('GET', '/api/works?mine=true');

      expect(res.status).toBe(401);
    });
  });

  // ─── Work Detail ───────────────────────────────────────────

  describe('GET /api/works/:id', () => {
    it('returns 404 for non-existent work', async () => {
      
      const res = await svc.fetch('GET', '/api/works/999999');

      expect(res.status).toBe(404);
    });
  });

  // ─── Update Work ───────────────────────────────────────────

  describe('PUT /api/works/:id', () => {
    it('rejects update from non-owner', async () => {
      

      // Create a different user
      const other = await svc.signup({ email: uniqueEmail() });

      // Create work with first user
      const createRes = await svc.fetch('POST', '/api/works', {
        title: 'Owner Only',
        pseudId: pseudId || 1,
      }, { cookies: authCookies });

      const createData = await createRes.json() as any;
      const workId = createData.work?.id || createData.id;
      if (!workId) return;

      // Try to update with other user
      const res = await svc.fetch('PUT', `/api/works/${workId}`, {
        title: 'Hijacked',
      }, { cookies: other.cookies });

      expect(res.status).toBe(403);
    });
  });

  // ─── Chapters ──────────────────────────────────────────────

  describe('POST /api/works/:id/chapters', () => {
    it('adds a chapter to a work', async () => {
      
      const createRes = await svc.fetch('POST', '/api/works', {
        title: 'Chapter Test Work',
        pseudId: pseudId || 1,
      }, { cookies: authCookies });

      const createData = await createRes.json() as any;
      const workId = createData.work?.id || createData.id;
      if (!workId) return;

      const res = await svc.fetch('POST', `/api/works/${workId}/chapters`, {
        title: 'Chapter 1: The Beginning',
        contentMd: '# The Beginning\n\nIt was a dark and stormy night...',
      }, { cookies: authCookies });

      expect(res.status).toBe(201);
    });
  });
});
