export const prerender = false;

import type { APIRoute } from 'astro';

const GITHUB_REPO_OWNER = 'triursa';
const GITHUB_REPO_NAME = 'fanfiction-fyi';
const MAX_DESCRIPTION_LENGTH = 2000;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REPORTS_PER_WINDOW = 3;

// In-memory rate limit (per-isolate; good enough for small scale)
const recentReports = new Map<string, number[]>();

function getClientIP(request: Request): string {
  // Cloudflare provides the real IP in CF-Connecting-IP
  return request.headers.get('CF-Connecting-IP') ?? 
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 
         'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = recentReports.get(ip) ?? [];
  // Filter to only timestamps within the window
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  recentReports.set(ip, recent);
  return recent.length >= MAX_REPORTS_PER_WINDOW;
}

function sanitizeForGitHub(text: string): string {
  // Remove any null bytes and trim
  return text.replace(/\0/g, '').trim();
}

export const POST: APIRoute = async ({ request, locals }) => {
  const ip = getClientIP(request);

  // Rate limit check
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ 
      error: 'Too many reports. Please wait a minute before submitting another.' 
    }), { 
      status: 429, 
      headers: { 
        'Content-Type': 'application/json',
        'Retry-After': '60' 
      } 
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  const description = sanitizeForGitHub(String(body.description ?? ''));
  const page = sanitizeForGitHub(String(body.page ?? ''));
  const userAgent = sanitizeForGitHub(String(body.userAgent ?? ''));
  const timestamp = new Date().toISOString();

  if (!description) {
    return new Response(JSON.stringify({ error: 'Description is required' }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return new Response(JSON.stringify({ error: `Description too long (max ${MAX_DESCRIPTION_LENGTH} characters)` }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  // Get GitHub token from env
  const githubToken = (locals.runtime.env as any).GITHUB_TOKEN;
  if (!githubToken) {
    console.error('GITHUB_TOKEN env var not set — cannot create bug report issue');
    return new Response(JSON.stringify({ error: 'Bug reporting is not configured. Please try again later.' }), { 
      status: 503, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  // Build issue title and body
  const title = `Bug: ${description.slice(0, 80)}${description.length > 80 ? '…' : ''}`;
  const issueBody = [
    `**Page:** ${page || 'Not provided'}`,
    `**Reported:** ${timestamp}`,
    `**User-Agent:** ${userAgent || 'Not provided'}`,
    '',
    '---',
    '',
    description,
  ].join('\n');

  // Create GitHub issue
  try {
    const ghResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'fanfiction-fyi-bug-report',
      },
      body: JSON.stringify({
        title,
        body: issueBody,
        labels: ['bug', 'user-reported'],
      }),
    });

    if (!ghResponse.ok) {
      const errorText = await ghResponse.text();
      console.error(`GitHub API error: ${ghResponse.status} ${errorText}`);
      return new Response(JSON.stringify({ error: 'Failed to submit bug report. Please try again later.' }), { 
        status: 502, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    const issue = await ghResponse.json();

    // Record this report for rate limiting
    const now = Date.now();
    const timestamps = recentReports.get(ip) ?? [];
    timestamps.push(now);
    recentReports.set(ip, timestamps);

    return new Response(JSON.stringify({ 
      ok: true, 
      issue_number: issue.number,
      issue_url: issue.html_url,
    }), { 
      status: 201, 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (err: any) {
    console.error(`GitHub issue creation failed: ${err.message}`);
    return new Response(JSON.stringify({ error: 'Failed to submit bug report. Please try again later.' }), { 
      status: 502, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
};