export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { tags } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import type { APIRoute } from 'astro';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDate(isoStr: string): string {
  // D1 stores as ISO 8601; convert to RFC 822 for RSS
  const d = new Date(isoStr + 'Z');
  return d.toUTCString();
}

export const GET: APIRoute = async ({ locals, url }) => {
  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const tagId = url.searchParams.get('tag_id');

  let channelTitle = 'fanfiction.fyi';
  const channelLink = 'https://fanfiction.fyi';
  const channelDesc = 'A bespoke archive for a small circle of storytellers';

  let workRows: {
    id: number; title: string; summary: string | null; published_at: string | null; updated_at: string;
  }[];

  if (tagId) {
    // Per-tag feed: look up the tag name first
    const tag = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.id, Number(tagId))).get();
    if (!tag) {
      return new Response('Tag not found', { status: 404 });
    }
    channelTitle = `fanfiction.fyi - ${tag.name}`;

    // Works filtered by tag — use raw D1 for JOIN
    const { results } = await d1.prepare(`
      SELECT w.id, w.title, w.summary, w.published_at, w.updated_at
      FROM works w
      JOIN taggings tg ON tg.work_id = w.id
      WHERE w.published_at IS NOT NULL
        AND tg.tag_id = ?1
      ORDER BY w.published_at DESC
      LIMIT 25
    `).bind(tag.id).all<{
      id: number; title: string; summary: string | null; published_at: string | null; updated_at: string;
    }>();
    workRows = results ?? [];
  } else {
    // All published works — use raw D1
    const { results } = await d1.prepare(`
      SELECT w.id, w.title, w.summary, w.published_at, w.updated_at
      FROM works w
      WHERE w.published_at IS NOT NULL
      ORDER BY w.published_at DESC
      LIMIT 25
    `).all<{
      id: number; title: string; summary: string | null; published_at: string | null; updated_at: string;
    }>();
    workRows = results ?? [];
  }

  let itemsXml = '';

  for (const work of workRows) {
    // Fetch pseuds for this work — use raw D1 for JOIN
    const { results: pseudRows } = await d1.prepare(
      `SELECT p.name FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ?1`
    ).bind(work.id).all<{ name: string }>();
    const authorNames = (pseudRows ?? []).map(p => p.name).join(', ');

    // Fetch tags for this work — use raw D1 for JOIN
    const { results: tagRows } = await d1.prepare(
      `SELECT t.name FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ?1`
    ).bind(work.id).all<{ name: string }>();

    const pubDate = work.published_at ? formatDate(work.published_at) : '';

    const categoriesXml = (tagRows ?? []).map(t => `    <category>${escapeXml(t.name)}</category>`).join('\n');

    itemsXml += `  <item>
    <title>${escapeXml(work.title)}</title>
    <link>https://fanfiction.fyi/works/${work.id}</link>
    <description>${escapeXml(work.summary || '')}</description>
    <author>${escapeXml(authorNames)}</author>
${categoriesXml}
    <pubDate>${pubDate}</pubDate>
    <guid>https://fanfiction.fyi/works/${work.id}</guid>
  </item>
`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channelTitle)}</title>
    <link>${channelLink}</link>
    <description>${escapeXml(channelDesc)}</description>
    <language>en</language>
    <atom:link href="https://fanfiction.fyi/feed.xml${tagId ? `?tag_id=${encodeURIComponent(tagId)}` : ''}" rel="self" type="application/rss+xml"/>
${itemsXml}  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};