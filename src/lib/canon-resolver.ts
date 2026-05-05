/**
 * Canon Resolver — Server-side middleware that enriches rendered chapter HTML
 * with data-canon-type and data-canon-id attributes for inline deep-dives.
 */

import { getDrizzle } from '@/lib/db';
import { loreEntries, locations } from '@/lib/schema';
import { eq } from 'drizzle-orm';

interface CanonTerm {
  type: 'lore' | 'location';
  id: number;
  slug: string;
  title: string;
}

/**
 * Build a lookup map of all canon terms for a given fandom.
 * Returns a Map keyed by "type:slug" → CanonTerm
 */
export async function buildCanonIndex(
  db: D1Database,
  fandomTagId: number | null,
): Promise<Map<string, CanonTerm>> {
  const index = new Map<string, CanonTerm>();
  const drizzle = getDrizzle(db);

  // Load lore entries
  const loreQuery = fandomTagId
    ? drizzle.select({ id: loreEntries.id, slug: loreEntries.slug, title: loreEntries.title })
        .from(loreEntries).where(eq(loreEntries.fandomTagId, fandomTagId))
    : drizzle.select({ id: loreEntries.id, slug: loreEntries.slug, title: loreEntries.title })
        .from(loreEntries);

  const loreRows = await loreQuery;
  for (const entry of loreRows) {
    index.set(`lore:${entry.slug}`, {
      type: 'lore',
      id: entry.id,
      slug: entry.slug,
      title: entry.title,
    });
  }

  // Load locations
  const locQuery = fandomTagId
    ? drizzle.select({ id: locations.id, slug: locations.slug, title: locations.name })
        .from(locations).where(eq(locations.fandomTagId, fandomTagId))
    : drizzle.select({ id: locations.id, slug: locations.slug, title: locations.name })
        .from(locations);

  const locRows = await locQuery;
  for (const loc of locRows) {
    index.set(`location:${loc.slug}`, {
      type: 'location',
      id: loc.id,
      slug: loc.slug,
      title: loc.title,
    });
  }

  return index;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Enrich rendered HTML content with canon deep-dive data attributes.
 */
export function resolveCanonLinks(
  html: string,
  canonIndex: Map<string, CanonTerm>,
): string {
  if (!html || canonIndex.size === 0) return html;

  // Pass 1: Enrich existing wiki-link <a> tags with DB IDs
  html = html.replace(
    /<a\s+([^>]*class="wiki-link[^"]*"[^>]*)>/g,
    (match, attrs: string) => {
      const entityMatch = attrs.match(/data-entity="([^"]*)"/);
      const typeMatch = attrs.match(/data-type="([^"]*)"/);
      if (!entityMatch) return match;

      const entity = entityMatch[1];
      const type = typeMatch ? typeMatch[1] : null;
      const slug = slugify(entity);

      let canonTerm: CanonTerm | undefined;

      if (type === 'location') {
        canonTerm = canonIndex.get(`location:${slug}`);
      } else if (type === 'lore') {
        canonTerm = canonIndex.get(`lore:${slug}`);
      }

      if (!canonTerm) {
        canonTerm = canonIndex.get(`lore:${slug}`) || canonIndex.get(`location:${slug}`);
      }

      if (!canonTerm) return match;

      const canonType = canonTerm.type;
      const canonId = canonTerm.id;

      const enrichedAttrs = attrs
        .replace(/class="wiki-link([^"]*)"/, `class="wiki-link$1 canon-term"`)
        + ` data-canon-type="${canonType}" data-canon-id="${canonId}"`;

      return `<a ${enrichedAttrs}>`;
    },
  );

  // Pass 2: Auto-detect plain-text canon terms
  const termMap = new Map<string, CanonTerm>();
  for (const term of canonIndex.values()) {
    termMap.set(term.title, term);
  }

  if (termMap.size === 0) return html;

  const segments: string[] = [];
  let inTag = false;
  let inScript = false;
  let currentSeg = '';

  for (let i = 0; i < html.length; i++) {
    const ch = html[i];

    if (!inTag && ch === '<') {
      if (currentSeg) segments.push({ type: 'text', content: currentSeg } as any);
      currentSeg = '<';
      inTag = true;
      continue;
    }

    if (inTag && ch === '>') {
      currentSeg += '>';
      if (currentSeg.match(/^<script[\s>]/i)) inScript = true;
      if (currentSeg.match(/^<\/script>/i)) inScript = false;
      if (currentSeg.match(/^<style[\s>]/i)) inScript = true;
      if (currentSeg.match(/^<\/style>/i)) inScript = false;
      segments.push({ type: 'tag', content: currentSeg } as any);
      currentSeg = '';
      inTag = false;
      continue;
    }

    currentSeg += ch;
  }

  if (currentSeg) {
    segments.push({ type: inTag ? 'tag' : 'text', content: currentSeg } as any);
  }

  const sortedTerms = Array.from(termMap.entries())
    .sort((a, b) => b[0].length - a[0].length);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (typeof seg === 'string') continue;
    if (seg.type !== 'text') continue;

    let text = seg.content;

    for (const [termText, term] of sortedTerms) {
      const escaped = termText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'gi');

      text = text.replace(regex, (match) => {
        return `<span class="canon-term" data-canon-type="${term.type}" data-canon-id="${term.id}" data-canon-label="${termText}" role="button" tabindex="0">${match}</span>`;
      });
    }

    (segments[i] as any).content = text;
  }

  return segments.map(s => typeof s === 'string' ? s : s.content).join('');
}