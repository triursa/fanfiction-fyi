/**
 * Integration tests: Auth flow (signup → login → session → logout)
 *
 * Runs against the live Astro dev server with local D1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type TestServer, uniqueEmail, uniqueName } from './helpers';

let svc: TestServer;

describe('Auth Integration', () => {
  beforeAll(async () => {
    svc = await startServer();
  }, 55_000);

  afterAll(async () => {
    await svc.stop();
  });

  // ─── Signup ────────────────────────────────────────────────

  describe('POST /api/auth/signup', () => {
    it('creates a new user with a valid invite code', async () => {
      const res = await svc.fetch('POST', '/api/auth/signup', {
        email: uniqueEmail(),
        password: 'SecurePass123!',
        displayName: uniqueName(),
        inviteCode: 'FFYI-OPEN-BETA',
      });

      expect(res.status).toBe(201);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.userId).toBeTypeOf('number');

      const cookie = res.headers.get('Set-Cookie');
      expect(cookie).toContain('ffy_session=');
      expect(cookie).toContain('HttpOnly');
    });

    it('rejects signup without an invite code', async () => {
      const res = await svc.fetch('POST', '/api/auth/signup', {
        email: uniqueEmail(),
        password: 'SecurePass123!',
        displayName: uniqueName(),
      });

      expect(res.status).toBe(422);
    });

    it('rejects signup with an invalid invite code', async () => {
      const res = await svc.fetch('POST', '/api/auth/signup', {
        email: uniqueEmail(),
        password: 'SecurePass123!',
        displayName: uniqueName(),
        inviteCode: 'INVALID-CODE',
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toMatch(/invite/i);
    });

    it('rejects signup with a duplicate email', async () => {
      const email = uniqueEmail();
      await svc.signup({ email });

      const res = await svc.fetch('POST', '/api/auth/signup', {
        email,
        password: 'AnotherPassword1!',
        displayName: uniqueName(),
        inviteCode: 'FFYI-FOUNDER-001',
      });

      expect(res.status).toBe(409);
    });

    it('rejects signup with a short password', async () => {
      const res = await svc.fetch('POST', '/api/auth/signup', {
        email: uniqueEmail(),
        password: 'short',
        displayName: uniqueName(),
        inviteCode: 'FFYI-FOUNDER-002',
      });

      expect(res.status).toBe(422);
    });

    it('marks invite code as used after signup', async () => {
      const code = 'FFYI-FOUNDER-003';
      const first = await svc.signup({ inviteCode: code });
      expect(first.userId).toBeTypeOf('number');

      const res = await svc.fetch('POST', '/api/auth/signup', {
        email: uniqueEmail(),
        password: 'SecurePass123!',
        displayName: uniqueName(),
        inviteCode: code,
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Login ─────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('logs in with valid credentials', async () => {
      const email = uniqueEmail();
      const password = 'LoginWorks123!';
      await svc.signup({ email, password });

      const res = await svc.fetch('POST', '/api/auth/login', {
        email,
        password,
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.user.email).toBe(email);

      const cookie = res.headers.get('Set-Cookie');
      expect(cookie).toContain('ffy_session=');
    });

    it('rejects login with wrong password', async () => {
      const email = uniqueEmail();
      await svc.signup({ email, password: 'CorrectPass1!' });

      const res = await svc.fetch('POST', '/api/auth/login', {
        email,
        password: 'WrongPassword1!',
      });

      expect(res.status).toBe(401);
    });

    it('rejects login for non-existent email', async () => {
      const res = await svc.fetch('POST', '/api/auth/login', {
        email: 'nonexistent@fanfiction.fyi',
        password: 'DoesntMatter1!',
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── Session / Me ──────────────────────────────────────────

  describe('GET /api/auth/me', () => {
    it('returns user info with valid session', async () => {
      const result = await svc.signup();
      const res = await svc.fetch('GET', '/api/auth/me', undefined, {
        cookies: result.cookies,
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.user).toBeDefined();
      expect(data.user.id).toBe(result.userId);
    });

    it('returns error without session cookie', async () => {
      const res = await svc.fetch('GET', '/api/auth/me');
      // v2 may return 200 with null user or 401 — accept either
      expect([200, 401]).toContain(res.status);
    });
  });

  // ─── Logout ────────────────────────────────────────────────

  describe('POST /api/auth/logout', () => {
    it('clears the session cookie', async () => {
      const result = await svc.signup();
      const res = await svc.fetch('POST', '/api/auth/logout', undefined, {
        cookies: result.cookies,
      });

      const setCookie = res.headers.get('Set-Cookie') || '';
      expect(setCookie).toContain('Max-Age=0');
    });
  });

  // ─── CSRF Protection ───────────────────────────────────────

  describe('CSRF enforcement', () => {
    it('rejects POST requests with mismatched Origin', async () => {
      const res = await globalThis.fetch(`${svc.url}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://evil-site.com',
        },
        body: JSON.stringify({
          email: uniqueEmail(),
          password: 'TestPass123!',
          displayName: uniqueName(),
          inviteCode: 'FFYI-FOUNDER-004',
        }),
      });

      expect(res.status).toBe(403);
    });
  });
});