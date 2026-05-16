/**
 * v2 Middleware — Auth enforcement, CSRF protection, CSP headers.
 *
 * Route auth levels are declared via `config.auth` exports:
 *   - 'public':    No auth required (homepage, browse, read, search)
 *   - 'optional':  Auth if available, but page works for guests (work detail with kudos toggle)
 *   - 'required':  Must be logged in (studio, settings, admin, write APIs)
 *
 * Default is 'required' — routes must explicitly opt into 'public' or 'optional'.
 */

import { defineMiddleware } from 'astro:middleware';
import { getDb } from '@/v2/lib/db';
import { users, sessions } from '@/v2/lib/schema/index';
import { eq, and, gt, sql } from 'drizzle-orm';
import type { D1Database } from '@cloudflare/workers-types';

// ─── Types ────────────────────────────────────────────────────────

export type AuthLevel = 'public' | 'optional' | 'required';

export interface RouteConfig {
  auth: AuthLevel;
}

declare module 'astro:middleware' {
  interface Locals {
    user?: {
      id: number;
      email: string;
      role: string;
      approved: number;
      banned: number;
      suspendedUntil: string | null;
    };
    runtime: {
      env: {
        DB: D1Database;
        MEDIA: R2Bucket;
      };
    };
  }
}

// ─── Auth resolution ──────────────────────────────────────────────
// Reads the route's `config.auth` export if present, otherwise defaults to 'required'.

function getAuthLevel(pathname: string, request: Request): AuthLevel {
  // ─── Public pages (no auth, never needs user context) ───────
  if (pathname === '/login' || pathname === '/signup') return 'public';
  if (pathname === '/pending-approval') return 'public';
  if (pathname === '/privacy' || pathname === '/terms') return 'public';
  if (pathname === '/feed.xml') return 'public';

  // ─── Optional pages (accessible without auth, but resolve user if session exists) ──
  // Homepage and browse pages need user context for personalized nav (Sign In vs Profile)
  if (pathname === '/') return 'optional';
  if (pathname === '/works' || pathname.startsWith('/works/')) return 'optional';
  if (pathname === '/pseuds' || pathname.startsWith('/pseuds/')) return 'optional';
  if (pathname === '/tags' || pathname.startsWith('/tags/')) return 'optional';
  if (pathname === '/series' || pathname.startsWith('/series/')) return 'optional';
  if (pathname === '/collections' || pathname.startsWith('/collections/')) return 'optional';
  if (pathname === '/canon' || pathname.startsWith('/canon/')) return 'optional';
  if (pathname === '/characters' || pathname.startsWith('/characters/')) return 'optional';
  if (pathname === '/search') return 'optional';

  // Static assets
  if (pathname.startsWith('/_astro/') || pathname.startsWith('/favicon')) return 'public';

  // ─── Public API endpoints ─────────────────────────────────────
  if (pathname.startsWith('/api/auth/')) return 'public';

  // Public read endpoints
  if (pathname === '/api/works' && request.method === 'GET') return 'public';
  if (pathname.match(/^\/api\/works\/\d+$/) && request.method === 'GET') return 'public';
  if (pathname.startsWith('/api/pseuds') && request.method === 'GET') return 'public';
  if (pathname.startsWith('/api/tags') && request.method === 'GET') return 'public';
  if (pathname.startsWith('/api/search')) return 'public';
  if (pathname.startsWith('/api/collections') && request.method === 'GET') return 'public';
  if (pathname.startsWith('/api/series') && request.method === 'GET') return 'public';
  if (pathname.startsWith('/api/canon') && request.method === 'GET') return 'public';
  if (pathname.startsWith('/api/kudos') && request.method === 'GET') return 'public';
  if (pathname.startsWith('/api/readings') && request.method === 'GET') return 'public';
  if (pathname.startsWith('/api/bookmarks') && request.method === 'GET') return 'public';
  if (pathname.startsWith('/api/comments') && request.method === 'GET') return 'public';
  if (pathname.match(/^\/api\/works\/\d+\/chapters$/) && request.method === 'GET') return 'public';
  if (pathname.match(/^\/api\/works\/\d+\/chapters\/\d+$/) && request.method === 'GET') return 'public';
  if (pathname.match(/^\/api\/works\/\d+\/kudos$/) && request.method === 'GET') return 'public';
  if (pathname.match(/^\/api\/works\/\d+\/comments$/) && request.method === 'GET') return 'public';

  // ─── Default: auth required (safe default) ───────────────────
  return 'required';
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

// ─── Cookie constants ─────────────────────────────────────────────

const SESSION_COOKIE = 'ffy_session';
const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ─── Response helpers ─────────────────────────────────────────────

function jsonResponse(body: object, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function redirect(url: string, extraHeaders?: Record<string, string>): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url, ...extraHeaders },
  });
}

// ─── CSRF Protection ──────────────────────────────────────────────
// v2 uses SameSite=Lax cookies + Origin header check for CSRF.
// POST/PUT/DELETE/PATCH requests must have a matching Origin header.

function verifyOrigin(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

  const origin = request.headers.get('Origin');
  if (!origin) return true; // Non-browser clients (API keys, curl) may not send Origin

  const allowedHosts = ['fanfiction.fyi', 'staging.fanfiction.fyi', 'localhost:4321'];
  try {
    const url = new URL(origin);
    // Allow any localhost port in development / test
    return allowedHosts.some(host => url.host === host)
      || url.hostname === 'localhost'
      || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// ─── CSP Headers ─────────────────────────────────────────────────

function cspHeaders(): Record<string, string> {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'https://fanfiction.fyi'],
    'connect-src': ["'self'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };

  const value = Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');

  // V2: Enforce CSP (not report-only)
  return { 'Content-Security-Policy': value };
}

// ─── Main middleware ──────────────────────────────────────────────

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const authLevel = getAuthLevel(pathname, context.request);
  const isApi = isApiRoute(pathname);

  // ─── CORS preflight for API routes ──────────────────────────
  if (isApi && context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': context.request.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // ─── CSRF: Verify Origin on state-changing requests ────────
  if (!verifyOrigin(context.request)) {
    return jsonResponse({ error: 'CSRF check failed' }, 403);
  }

  // ─── Public routes: skip auth entirely ─────────────────────
  if (authLevel === 'public') {
    const response = await next();
    // Apply CSP to all responses
    for (const [header, value] of Object.entries(cspHeaders())) {
      response.headers.set(header, value);
    }
    // Add CORS headers for public API routes
    if (isApi) {
      response.headers.set('Access-Control-Allow-Origin', context.request.headers.get('Origin') || '*');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }
    return response;
  }

  // ─── Read session cookie ────────────────────────────────────
  const cookieHeader = context.request.headers.get('cookie') ?? '';
  const sessionMatch = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([a-f0-9]+)`));

  // ─── Optional: no session → continue without user ──────────
  if (authLevel === 'optional' && !sessionMatch) {
    const response = await next();
    for (const [header, value] of Object.entries(cspHeaders())) {
      response.headers.set(header, value);
    }
    return response;
  }

  // ─── Required: no session → 401/redirect ───────────────────
  if (!sessionMatch) {
    if (isApi) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    return redirect('/login');
  }

  // ─── Look up session in D1 ─────────────────────────────────
  const d1 = context.locals.runtime.env.DB as D1Database;
  const db = getDb(d1);
  const token = sessionMatch[1];

  const session = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, sql`datetime('now')`)))
    .get();

  if (!session) {
    // Optional routes: invalid/expired session → continue as guest (clear stale cookie)
    if (authLevel === 'optional') {
      const response = await next();
      response.headers.set('Set-Cookie', CLEAR_COOKIE);
      for (const [header, value] of Object.entries(cspHeaders())) {
        response.headers.set(header, value);
      }
      return response;
    }
    const headers: Record<string, string> = { 'Set-Cookie': CLEAR_COOKIE };
    if (isApi) {
      return jsonResponse({ error: 'Unauthorized' }, 401, headers);
    }
    return redirect('/login', headers);
  }

  // ─── Look up user ──────────────────────────────────────────
  const user = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      approved: users.approved,
      banned: users.banned,
      suspendedUntil: users.suspendedUntil,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();

  if (!user) {
    // Optional routes: user not found → continue as guest
    if (authLevel === 'optional') {
      const response = await next();
      response.headers.set('Set-Cookie', CLEAR_COOKIE);
      for (const [header, value] of Object.entries(cspHeaders())) {
        response.headers.set(header, value);
      }
      return response;
    }
    const headers: Record<string, string> = { 'Set-Cookie': CLEAR_COOKIE };
    if (isApi) {
      return jsonResponse({ error: 'Unauthorized' }, 401, headers);
    }
    return redirect('/login', headers);
  }

  // ─── Banned users: destroy session, redirect ──────────────
  if (user.banned) {
    await db.delete(sessions).where(eq(sessions.token, token));
    // Optional routes: banned → continue as guest (session already deleted)
    if (authLevel === 'optional') {
      const response = await next();
      response.headers.set('Set-Cookie', CLEAR_COOKIE);
      for (const [header, value] of Object.entries(cspHeaders())) {
        response.headers.set(header, value);
      }
      return response;
    }
    if (isApi) {
      return jsonResponse({ error: 'Banned' }, 403);
    }
    return redirect('/login?error=banned', { 'Set-Cookie': CLEAR_COOKIE });
  }

  // ─── Suspended users: block until suspension lifts ────────
  if (user.suspendedUntil) {
    const suspendedTime = new Date(user.suspendedUntil + 'Z').getTime();
    if (Date.now() < suspendedTime) {
      // Optional routes: suspended → continue as guest
      if (authLevel === 'optional') {
        const response = await next();
        for (const [header, value] of Object.entries(cspHeaders())) {
          response.headers.set(header, value);
        }
        return response;
      }
      if (isApi) {
        return jsonResponse({ error: 'suspended', suspendedUntil: user.suspendedUntil }, 403);
      }
      return redirect(`/login?error=suspended&until=${encodeURIComponent(user.suspendedUntil)}`);
    }
    // Suspension expired — auto-restore
    await db.update(users).set({ suspendedUntil: null }).where(eq(users.id, user.id));
  }

  // ─── Unapproved users: only access pending-approval page ──
  // Optional routes: unapproved → treat as guest (no personalized features)
  if (!user.approved && authLevel === 'optional') {
    const response = await next();
    for (const [header, value] of Object.entries(cspHeaders())) {
      response.headers.set(header, value);
    }
    return response;
  }
  if (!user.approved) {
    if (pathname === '/pending-approval' || pathname === '/api/auth/me' || pathname === '/api/auth/logout') {
      context.locals.user = user;
      const response = await next();
      for (const [header, value] of Object.entries(cspHeaders())) {
        response.headers.set(header, value);
      }
      return response;
    }
    if (isApi) {
      return jsonResponse({ error: 'Unapproved' }, 403);
    }
    return redirect('/pending-approval');
  }

  // ─── Approved user: set locals and continue ────────────────
  context.locals.user = user;

  const response = await next();
  for (const [header, value] of Object.entries(cspHeaders())) {
    response.headers.set(header, value);
  }
  // CORS for API responses
  if (isApi) {
    response.headers.set('Access-Control-Allow-Origin', context.request.headers.get('Origin') || '*');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return response;
});