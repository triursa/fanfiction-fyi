import { defineMiddleware } from 'astro:middleware';
import { queryFirst } from '@/lib/db';

// Paths accessible without authentication or approval
const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/pending-approval',
  '/feed.xml',
  '/privacy',
  '/terms',
];

const PUBLIC_PATH_PREFIXES = [
  '/api/auth/',
  '/api/bugs/',
  '/_astro/',
];

function isPublicPath(pathname: string): boolean {
  // Static assets
  if (pathname.startsWith('/_astro/') || pathname.startsWith('/favicon')) return true;
  // Auth and bug report APIs
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/api/bugs/')) return true;
  // Public read-only API endpoints
  if (pathname.startsWith('/api/works') && !pathname.includes('/chapters/')) return true;
  if (pathname.startsWith('/api/pseuds')) return true;
  if (pathname.startsWith('/api/tags')) return true;
  if (pathname.startsWith('/api/search')) return true;
  if (pathname.startsWith('/api/collections')) return true;
  if (pathname.startsWith('/api/series')) return true;
  if (pathname.startsWith('/api/characters')) return true;
  // Public content pages (browse, read, search)
  if (pathname === '/works' || pathname.startsWith('/works/')) return true;
  if (pathname === '/characters' || pathname.startsWith('/characters/')) return true;
  if (pathname === '/tags' || pathname.startsWith('/tags/')) return true;
  if (pathname === '/series' || pathname.startsWith('/series/')) return true;
  if (pathname === '/collections' || pathname.startsWith('/collections/')) return true;
  if (pathname === '/search') return true;
  if (pathname === '/') return true;

  // Exact match paths
  if (PUBLIC_PATHS.includes(pathname)) return true;

  return false;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Allow all public paths through without auth checks
  if (isPublicPath(pathname)) {
    return next();
  }

  // Read session cookie
  const cookie = context.request.headers.get('cookie') ?? '';
  const sessionMatch = cookie.match(/session=([a-f0-9]+)/);
  if (!sessionMatch) {
    // Not authenticated — return 401 JSON for API routes, redirect for pages
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return context.redirect('/login');
  }

  const db = context.locals.runtime.env.DB as D1Database;

  // Look up session and user
  const session = await queryFirst<{ user_id: number }>(
    db,
    `SELECT user_id FROM sessions WHERE token = ?1 AND expires_at > datetime('now')`,
    sessionMatch[1]
  );

  if (!session) {
    // Invalid/expired session
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login',
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }

  const user = await queryFirst<{ id: number; role: string; approved: number; banned: number }>(
    db,
    `SELECT id, role, approved, banned FROM users WHERE id = ?1`,
    session.user_id
  );

  if (!user) {
    // User deleted but session exists
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login',
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }

  // Banned users — destroy session and redirect to login with error
  if (user.banned) {
    await db.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(sessionMatch[1]).run();
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/login?error=banned',
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }

  // Unapproved users — allow /pending-approval, /api/auth/me, and /api/auth/logout
  if (!user.approved) {
    if (pathname === '/pending-approval' || pathname === '/api/auth/me' || pathname === '/api/auth/logout') {
      context.locals.user = user;
      return next();
    }
    return context.redirect('/pending-approval');
  }

  // Approved user — set user info in locals and continue
  context.locals.user = user;
  return next();
});