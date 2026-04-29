export const prerender = false;

import type { APIRoute } from 'astro';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rate-limit';

const GITHUB_REPO_OWNER = 'triursa';
const GITHUB_REPO_NAME = 'fanfiction-fyi';
const MAX_DESCRIPTION_LENGTH = 2000;

function getClientIP(request: Request): string {
  // Cloudflare provides the real IP in CF-Connecting-IP
  return request.headers.get('CF-Connecting-IP') ?? 
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 
         'unknown';
}

function sanitizeForGitHub(text: string): string {
  // Remove any null bytes and trim
  return text.replace(/\0/g, '').trim();
}

export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.runtime.env.DB as D1Database;
  const ip = getClientIP(request);

  // D1-backed rate limit check (3 bug reports per 5 minutes per IP)
  const rl = await checkRateLimit(db, ip, 'bug-report');
  if (!rl.allowed) {
    return new Response(JSON.stringify({ 
      error: 'Too many reports. Please wait before submitting another.' 
    }), { 
      status: 429, 
      headers: { 
        'Content-Type': 'application/json',
        'Retry-After': String(rl.retryAfterSeconds)
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

    // Record this report for D1 rate limiting
    await recordFailedAttempt(db, ip, 'bug-report');

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