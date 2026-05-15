/**
 * Integration test utilities for fanfiction.fyi v2.
 *
 * Manages the dev server lifecycle and provides HTTP helpers for
 * testing API routes against the real Astro + D1 stack.
 */

import { ChildProcess, spawn } from 'child_process';
import { randomBytes } from 'crypto';

// ─── Types ────────────────────────────────────────────────────

export interface TestServer {
  url: string;
  port: number;
  fetch: FetchFn;
  stop: () => Promise<void>;
  login: (email: string, password: string) => Promise<string>;
  signup: (overrides?: Partial<SignupPayload>) => Promise<SignupResult>;
}

export type FetchFn = (
  method: string,
  path: string,
  body?: object,
  options?: RequestOptions,
) => Promise<Response>;

export interface RequestOptions {
  cookies?: string;
  headers?: Record<string, string>;
}

export interface SignupPayload {
  email: string;
  password: string;
  displayName: string;
  inviteCode: string;
}

export interface SignupResult {
  cookies: string;
  userId: number;
}

// ─── Server lifecycle ─────────────────────────────────────────

let serverProcess: ChildProcess | null = null;
let serverUrl: string | null = null;

/**
 * Start the Astro dev server with Cloudflare D1 bindings.
 * Uses health check polling instead of stdout parsing for robustness.
 * Returns once the server responds to an HTTP request (or times out).
 */
export async function startServer(port: number = 0): Promise<TestServer> {
  // Reset invite codes so tests have fresh codes to use
  const { execSync } = await import('child_process');
  const cwd = '/Volumes/4TB/Repositories/fanfiction-fyi';
  const wrangler = '/Volumes/4TB/Repositories/fanfiction-fyi/node_modules/.bin/wrangler';
  try {
    execSync(`${wrangler} d1 execute ffy-dev --local --command="UPDATE invite_codes SET used_by = NULL, used_at = NULL WHERE used_by IS NOT NULL;"`, { cwd, stdio: 'ignore' });
    execSync(`${wrangler} d1 execute ffy-dev --local --command="DELETE FROM sessions;"`, { cwd, stdio: 'ignore' });
  } catch (e) {
    // Non-fatal — tests may still work if DB was already clean
    console.warn('DB reset warning:', (e as Error).message);
  }

  // Use a random high port to avoid conflicts
  const actualPort = port || (14000 + Math.floor(Math.random() * 1000));
  const url = `http://localhost:${actualPort}`;
  serverUrl = url;

  // Kill any existing process on this port first
  try {
    const { execSync } = await import('child_process');
    execSync(`lsof -ti:${actualPort} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  } catch { /* ignore */ }

  return new Promise((resolve, reject) => {
    const startupTimeout = setTimeout(() => {
      if (serverProcess) { serverProcess.kill(); serverProcess = null; }
      reject(new Error('Dev server failed to start within 45s'));
    }, 45_000);

    serverProcess = spawn('node', [
      '/Volumes/4TB/Repositories/fanfiction-fyi/node_modules/.bin/astro',
      'dev',
      '--port', String(actualPort),
    ], {
      cwd: '/Volumes/4TB/Repositories/fanfiction-fyi',
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Log server output for debugging
    serverProcess.stdout?.on('data', (data: Buffer) => {
      if (process.env.DEBUG_INTEGRATION) process.stderr.write(data);
    });
    serverProcess.stderr?.on('data', (data: Buffer) => {
      if (process.env.DEBUG_INTEGRATION) process.stderr.write(data);
    });

    serverProcess.on('error', (err) => {
      clearTimeout(startupTimeout);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null && !serverUrl) {
        clearTimeout(startupTimeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Poll the server until it responds
    const pollInterval = setInterval(async () => {
      try {
        const res = await globalThis.fetch(`${url}/api/tags?limit=1`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok || res.status === 200) {
          clearTimeout(startupTimeout);
          clearInterval(pollInterval);
          resolve(buildTestServer(url, actualPort));
        }
      } catch {
        // Not ready yet, keep polling
      }
    }, 1000);
  });
}

function buildTestServer(url: string, port: number): TestServer {
  return {
    url,
    port,
    fetch: makeFetch(url),
    stop: async () => {
      if (serverProcess) {
        serverProcess.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          serverProcess?.on('exit', () => resolve());
          setTimeout(() => { serverProcess?.kill('SIGKILL'); resolve(); }, 5000);
        });
        serverProcess = null;
        serverUrl = null;
      }
    },
    login: makeLogin(url),
    signup: makeSignup(url),
  };
}

// ─── HTTP helpers ─────────────────────────────────────────────

function makeFetch(baseUrl: string): FetchFn {
  return async function fetch(
    method: string,
    path: string,
    body?: object,
    options?: RequestOptions,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    // Set Origin header for CSRF (middleware checks it)
    headers['Origin'] = baseUrl;

    if (options?.cookies) {
      headers['Cookie'] = options.cookies;
    }

    return globalThis.fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };
}

function makeLogin(baseUrl: string): TestServer['login'] {
  return async (email: string, password: string): Promise<string> => {
    const res = await globalThis.fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': baseUrl },
      body: JSON.stringify({ email, password }),
    });

    if (res.status !== 200) {
      const text = await res.text();
      throw new Error(`Login failed (${res.status}): ${text}`);
    }

    return res.headers.get('Set-Cookie') || '';
  };
}

function makeSignup(baseUrl: string): TestServer['signup'] {
  return async (overrides?: Partial<SignupPayload>): Promise<SignupResult> => {
    const suffix = randomBytes(4).toString('hex');
    const payload: SignupPayload = {
      email: `test-${suffix}@integration.fyi`,
      password: 'TestPass123!',
      displayName: `TestUser${suffix}`,
      inviteCode: `ITEST-${suffix}`,
      ...overrides,
    };

    // Create a fresh invite code for this signup
    const { execSync } = await import('child_process');
    const wrangler = '/Volumes/4TB/Repositories/fanfiction-fyi/node_modules/.bin/wrangler';
    try {
      execSync(`${wrangler} d1 execute ffy-dev --local --command="INSERT OR IGNORE INTO invite_codes (code, created_by_id) VALUES ('${payload.inviteCode}', 1);"`, { cwd: '/Volumes/4TB/Repositories/fanfiction-fyi', stdio: 'ignore' });
    } catch { /* ignore */ }

    const res = await globalThis.fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': baseUrl },
      body: JSON.stringify(payload),
    });

    if (res.status !== 201) {
      const text = await res.text();
      throw new Error(`Signup failed (${res.status}): ${text}`);
    }

    const data = await res.json() as { success: boolean; userId: number };
    return { cookies: res.headers.get('Set-Cookie') || '', userId: data.userId };
  };
}

// ─── Unique identifier generators ─────────────────────────────

export function uniqueEmail(): string {
  return `test-${randomBytes(6).toString('hex')}@integration.fyi`;
}

export function uniqueName(): string {
  return `Test${randomBytes(3).toString('hex')}`;
}

// ─── Shared server accessor ───────────────────────────────────

export function getServer(): TestServer {
  const srv = (globalThis as any).__FFY_TEST_SERVER__ as TestServer | undefined;
  if (!srv) throw new Error('Test server not initialized — did globalSetup run?');
  return srv;
}