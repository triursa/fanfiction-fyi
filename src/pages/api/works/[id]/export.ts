export const prerender = false;

import { queryFirst, queryAll } from '@/lib/db';
import epub from 'epub-gen-memory';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, locals, url }) => {
  const format = url.searchParams.get('format');
  if (format !== 'epub') {
    return new Response(JSON.stringify({ error: 'Unsupported format. Use ?format=epub' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = locals.runtime.env.DB as D1Database;
  const workId = Number(params.id);
  if (!workId) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const work = await queryFirst<any>(db, `SELECT * FROM works WHERE id = ?1`, workId);
  if (!work) {
    return new Response(JSON.stringify({ error: 'Work not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Only allow export for published works
  if (!work.published_at) {
    return new Response(JSON.stringify({ error: 'Work is not published' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch author pseud names from creatorships
  const pseuds = await queryAll<any>(
    db,
    `SELECT p.name FROM pseuds p JOIN creatorships c ON p.id = c.pseud_id WHERE c.work_id = ?1`,
    workId,
  );

  // Fetch all published chapters (draft=0) with title and content_html
  const chapters = await queryAll<any>(
    db,
    `SELECT title, content_html, content_md FROM chapters WHERE work_id = ?1 AND draft = 0 ORDER BY position`,
    workId,
  );

  if (chapters.length === 0) {
    return new Response(JSON.stringify({ error: 'No published chapters' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const epubOptions = {
    title: work.title || 'Untitled',
    author: pseuds.map((p: any) => p.name),
    description: work.summary || undefined,
    lang: work.language || 'en',
    css: `
      body { font-family: serif; line-height: 1.8; margin: 1em; }
      h1, h2, h3 { margin: 1.5em 0 0.5em; }
      p { margin: 0.5em 0; }
    `,
  };

  const epubContent = chapters.map((ch: any) => ({
    title: ch.title || 'Untitled Chapter',
    data: ch.content_html || ch.content_md || '<p>Content not available.</p>',
  }));

  try {
    const buffer = await epub(epubOptions, epubContent);

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/epub+zip',
        'Content-Disposition': `attachment; filename="${(work.slug || work.title || 'work').replace(/[^a-zA-Z0-9-_]/g, '_')}.epub"`,
      },
    });
  } catch (err: any) {
    console.error('EPUB generation error:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate EPUB' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};