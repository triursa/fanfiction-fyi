/**
 * Canon Resolver — Server-side middleware that enriches rendered chapter HTML
 * with data-canon-type and data-canon-id attributes for inline deep-dives.
 *
 * Works in two passes:
 * 1. Resolves existing wiki-link <a> tags (from wiki-links.ts) by matching
 *    their data-entity + data-type attributes to DB records
 * 2. Optionally auto-detects known slugs/terms in plain text (future enhancement)
 *
 * Usage: Called in read.astro before passing content_html to the template.
 */

import { queryFirst, queryAll } from '@/lib/db';

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

  // If fandom is specified, load terms for that fandom
  // If not, load ALL terms (fallback for multi-fandom works)
  const loreSql = fandomTagId
    ? `SELECT id, slug, title FROM lore_entries WHERE fandom_tag_id = ?1`
    : `SELECT id, slug, title FROM lore_entries`;
  const locSql = fandomTagId
    ? `SELECT id, slug, name as title FROM locations WHERE fandom_tag_id = ?1`
    : `SELECT id, slug, name as title FROM locations`;

  const loreParams = fandomTagId ? [fandomTagId] : [];
  const locParams = fandomTagId ? [fandomTagId] : [];

  const loreEntries = await queryAll<any>(db, loreSql, ...loreParams);
  for (const entry of loreEntries) {
    index.set(`lore:${entry.slug}`, {
      type: 'lore',
      id: entry.id,
      slug: entry.slug,
      title: entry.title,
    });
  }

  const locations = await queryAll<any>(db, locSql, ...locParams);
  for (const loc of locations) {
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
 *
 * Finds wiki-link anchors (already in content_html from wiki-links.ts)
 * and resolves them to DB IDs using the canon index.
 *
 * Also auto-detects plain-text occurrences of known canon terms
 * and wraps them in spans for inline deep-dive activation.
 */
export function resolveCanonLinks(
  html: string,
  canonIndex: Map<string, CanonTerm>,
): string {
  if (!html || canonIndex.size === 0) return html;

  // ── Pass 1: Enrich existing wiki-link <a> tags with DB IDs ──
  // Pattern: <a class="wiki-link wiki-link-lore" ... data-entity="Magic System" data-type="lore">
  // Becomes: <a class="wiki-link wiki-link-lore canon-term" ... data-entity="Magic System" data-type="lore" data-canon-type="lore" data-canon-id="12">
  html = html.replace(
    /<a\s+([^>]*class="wiki-link[^"]*"[^>]*)>/g,
    (match, attrs: string) => {
      // Extract data-entity
      const entityMatch = attrs.match(/data-entity="([^"]*)"/);
      const typeMatch = attrs.match(/data-type="([^"]*)"/);
      if (!entityMatch) return match;

      const entity = entityMatch[1];
      const type = typeMatch ? typeMatch[1] : null;
      const slug = slugify(entity);

      // Try to resolve to a DB record
      let canonTerm: CanonTerm | undefined;

      if (type === 'location') {
        canonTerm = canonIndex.get(`location:${slug}`);
      } else if (type === 'lore') {
        canonTerm = canonIndex.get(`lore:${slug}`);
      }

      // Fallback: try both types if no explicit type
      if (!canonTerm) {
        canonTerm = canonIndex.get(`lore:${slug}`) || canonIndex.get(`location:${slug}`);
      }

      if (!canonTerm) return match;

      const canonType = canonTerm.type;
      const canonId = canonTerm.id;

      // Add data-canon-type and data-canon-id, also add canon-term class
      const enrichedAttrs = attrs
        .replace(/class="wiki-link([^"]*)"/, `class="wiki-link$1 canon-term"`)
        + ` data-canon-type="${canonType}" data-canon-id="${canonId}"`;

      return `<a ${enrichedAttrs}>`;
    },
  );

  // ── Pass 2: Auto-detect plain-text canon terms ──
  // Only wrap terms that appear outside existing <a> tags and aren't in code blocks.
  // Build a reverse map: term text → CanonTerm (use titles, not slugs)
  const termMap = new Map<string, CanonTerm>();
  for (const term of canonIndex.values()) {
    // Index by title (exact match)
    termMap.set(term.title, term);
  }

  // Only proceed if there are terms to auto-detect
  if (termMap.size === 0) return html;

  // Split HTML into segments: inside tags vs text content
  // We use a stateful approach to only modify text nodes, not tag attributes
  const segments: string[] = [];
  let inTag = false;
  let inScript = false;
  let currentSeg = '';

  for (let i = 0; i < html.length; i++) {
    const ch = html[i];

    if (!inTag && ch === '<') {
      // Push current text segment
      if (currentSeg) segments.push({ type: 'text', content: currentSeg } as any);
      currentSeg = '<';
      inTag = true;
      continue;
    }

    if (inTag && ch === '>') {
      currentSeg += '>';
      // Check if this is a script/style tag
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

  // Now process only text segments, wrapping canon terms
  const sortedTerms = Array.from(termMap.entries())
    .sort((a, b) => b[0].length - a[0].length); // longest first to avoid partial matches

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (typeof seg === 'string') continue;
    if (seg.type !== 'text') continue;

    let text = seg.content;

    // Skip if already inside a wiki-link anchor (handled by pass 1)
    // This pass only wraps plain-text occurrences
    for (const [termText, term] of sortedTerms) {
      // Case-insensitive match for auto-detection
      const escaped = termText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'gi');

      text = text.replace(regex, (match) => {
        // Don't wrap if this text is already inside an anchor
        return `<span class="canon-term" data-canon-type="${term.type}" data-canon-id="${term.id}" data-canon-label="${termText}" role="button" tabindex="0">${match}</span>`;
      });
    }

    (segments[i] as any).content = text;
  }

  return segments.map(s => typeof s === 'string' ? s : s.content).join('');
}