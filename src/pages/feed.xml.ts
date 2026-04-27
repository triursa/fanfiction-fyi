export const prerender = false;

import { queryAll, queryFirst } from '@/lib/db';
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
  const db = locals.runtime.env.DB as D1Database;
  const tagId = url.searchParams.get('tag_id');

  let channelTitle = 'fanfiction.fyi';
  const channelLink = 'https://fanfiction.fyi';
  const channelDesc = 'A bespoke archive for a small circle of storytellers';

  let worksSql: string;
  let worksBindings: unknown[];

  if (tagId) {
    // Per-tag feed: look up the tag name first
    const tag = await queryFirst<any>(db, `SELECT id, name FROM tags WHERE id = ?1`, Number(tagId));
    if (!tag) {
      return new Response('Tag not found', { status: 404 });
    }
    channelTitle = `fanfiction.fyi - ${tag.name}`;
    worksSql = `
      SELECT w.id, w.title, w.summary, w.published_at, w.updated_at
      FROM works w
      JOIN taggings tg ON tg.work_id = w.id
      WHERE w.published_at IS NOT NULL
        AND tg.tag_id = ?
      ORDER BY w.published_at DESC
      LIMIT 25
    `;
    worksBindings = [tag.id];
  } else {
    worksSql = `
      SELECT w.id, w.title, w.summary, w.published_at, w.updated_at
      FROM works w
      WHERE w.published_at IS NOT NULL
      ORDER BY w.published_at DESC
      LIMIT 25
    `;
    worksBindings = [];
  }

  const works = await queryAll<any>(db, worksSql, ...worksBindings);

  let itemsXml = '';

  for (const work of works) {
    // Fetch pseuds for this work
    const pseuds = await queryAll<any>(
      db,
      `SELECT p.name FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ?1`,
      work.id
    );
    const authorNames = pseuds.map(p => p.name).join(', ');

    // Fetch tags for this work
    const tags = await queryAll<any>(
      db,
      `SELECT t.name FROM tags t JOIN taggings tg ON t.id = tg.tag_id WHERE tg.work_id = ?1`,
      work.id
    );

    const pubDate = work.published_at ? formatDate(work.published_at) : '';

    const categoriesXml = tags.map(t => `    <category>${escapeXml(t.name)}</category>`).join('\n');

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