export const prerender = false;

import { getDrizzle } from '@/lib/db';
import { works, chapters, creatorships, pseuds } from '@/lib/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { markdownToHtml } from '@/lib/markdown';
import type { APIRoute } from 'astro';
import epub from 'epub-gen-memory';

export const GET: APIRoute = async ({ params, locals, url }) => {
  const format = url.searchParams.get('format');
  if (format !== 'epub') {
    return new Response(JSON.stringify({ error: 'Unsupported format. Use ?format=epub' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const d1 = locals.runtime.env.DB as D1Database;
  const db = getDrizzle(d1);
  const workId = Number(params.id);
  if (!workId) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const work = await db.select().from(works).where(eq(works.id, workId)).get();
  if (!work) {
    return new Response(JSON.stringify({ error: 'Work not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Only allow export for published works
  if (!work.publishedAt) {
    return new Response(JSON.stringify({ error: 'Work is not published' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch author pseud names
  const pseudRows = await db.select({ name: pseuds.name })
    .from(pseuds)
    .innerJoin(creatorships, eq(pseuds.id, creatorships.pseudId))
    .where(eq(creatorships.workId, workId));

  // Fetch all published chapters
  const chapterRows = await db.select({
    title: chapters.title,
    contentHtml: chapters.contentHtml,
    contentMd: chapters.contentMd,
  }).from(chapters)
    .where(and(eq(chapters.workId, workId), eq(chapters.draft, 0)))
    .orderBy(chapters.position);

  if (chapterRows.length === 0) {
    return new Response(JSON.stringify({ error: 'No published chapters' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const epubOptions = {
    title: work.title || 'Untitled',
    author: pseudRows.map((p) => p.name),
    description: work.summary || undefined,
    lang: work.language || 'en',
    css: `
      body { font-family: serif; line-height: 1.8; margin: 1em; }
      h1, h2, h3 { margin: 1.5em 0 0.5em; }
      p { margin: 0.5em 0; }
    `,
  };

  const epubContent = chapterRows.map((ch) => ({
    title: ch.title || 'Untitled Chapter',
    data: ch.contentHtml || (ch.contentMd ? markdownToHtml(ch.contentMd) : '<p>Content not available.</p>'),
  }));

  try {
    const buffer = await epub(epubOptions, epubContent);

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/epub+zip',
        'Content-Disposition': `attachment; filename="${(work.title || 'work').replace(/[^a-zA-Z0-9-_]/g, '_')}.epub"`,
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