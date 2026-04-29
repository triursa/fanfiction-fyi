/**
 * Wiki-link parser for fanfiction.fyi Canon Layer
 *
 * Transforms `[[:...]]` wiki-link syntax into HTML anchor tags
 * BEFORE markdown-to-HTML conversion in the rendering pipeline.
 *
 * Syntax:
 *   [[:Character Name]]        → generic wiki-link
 *   [[:Location:Paris]]       → location wiki-link
 *   [[:Lore:Magic System]]    → explicit lore wiki-link
 */

/** Known type prefixes that modify the link href and classes */
const TYPE_PREFIXES = ['Location', 'Lore'] as const;
type TypePrefix = (typeof TYPE_PREFIXES)[number];

/** Regex that matches `[[:...]]` wiki-link patterns */
const WIKI_LINK_RE = /\[\[:([^\n\[\]]+?)\]\]/g;

/** Matches fenced code block opening (``` or ~~~ with optional lang) */
const FENCED_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})/;
/** Matches indented code block (4+ spaces at line start) */
const INDENTED_CODE_RE = /^ {4,}/;

/**
 * Escape special HTML characters in entity names to prevent injection.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * URL-encode a string for use in query parameters.
 */
function encodeQueryParam(s: string): string {
  return encodeURIComponent(s);
}

/**
 * Parse a single wiki-link inner content into type prefix + entity name.
 *
 * Examples:
 *   "Location:Paris"       → { type: 'Location', entity: 'Paris' }
 *   "Lore:Magic System"    → { type: 'Lore', entity: 'Magic System' }
 *   "Character Name"       → { type: null, entity: 'Character Name' }
 */
function parseInnerContent(inner: string): { type: TypePrefix | null; entity: string } {
  for (const prefix of TYPE_PREFIXES) {
    const prefixStr = prefix + ':';
    if (inner.startsWith(prefixStr)) {
      const entity = inner.slice(prefixStr.length).trim();
      if (entity.length > 0) {
        return { type: prefix, entity };
      }
    }
  }
  // No recognized type prefix → default (character / generic lore)
  return { type: null, entity: inner.trim() };
}

/**
 * Build the HTML anchor for a parsed wiki-link.
 */
function buildWikiLink(type: TypePrefix | null, entity: string): string {
  const escapedEntity = escapeHtml(entity);
  const encodedQ = encodeQueryParam(entity);

  if (type === 'Location') {
    return `<a class="wiki-link wiki-link-location" href="/canon/locations?q=${encodedQ}" data-entity="${escapedEntity}" data-type="location">${escapedEntity}</a>`;
  }

  if (type === 'Lore') {
    return `<a class="wiki-link wiki-link-lore" href="/canon?q=${encodedQ}" data-entity="${escapedEntity}" data-type="lore">${escapedEntity}</a>`;
  }

  // Default: generic wiki-link (character/lore entry)
  return `<a class="wiki-link" href="/canon?q=${encodedQ}" data-entity="${escapedEntity}">${escapedEntity}</a>`;
}

/**
 * Parse wiki-link syntax in markdown content and replace with HTML links.
 *
 * IMPORTANT: This runs BEFORE marked.parse(), so the markdown is still raw.
 * We must skip wiki-links inside code blocks:
 *   - Lines starting with 4+ spaces (indented code)
 *   - Content inside fenced code blocks (``` ... ```)
 */
export function parseWikiLinks(md: string): string {
  if (!md || !md.includes('[[:')) {
    return md;
  }

  // Split content into segments: code blocks vs non-code blocks
  const lines = md.split('\n');
  const resultLines: string[] = [];
  let insideFenced = false;
  let fenceMarker = '';

  for (const line of lines) {
    // Check for fenced code block boundaries
    const fenceMatch = line.match(FENCED_OPEN_RE);
    if (fenceMatch) {
      if (!insideFenced) {
        // Opening fence
        insideFenced = true;
        fenceMarker = fenceMatch[1][0]; // ` or ~
        resultLines.push(line);
        continue;
      } else if (fenceMatch[1][0] === fenceMarker && fenceMatch[1].length >= 3) {
        // Closing fence (must match opening character)
        insideFenced = false;
        fenceMarker = '';
        resultLines.push(line);
        continue;
      }
    }

    // Inside a fenced code block or indented code block → skip wiki-link processing
    if (insideFenced || INDENTED_CODE_RE.test(line)) {
      resultLines.push(line);
      continue;
    }

    // Process wiki-links on this line
    resultLines.push(line.replace(WIKI_LINK_RE, (match, inner: string) => {
      const { type, entity } = parseInnerContent(inner);
      if (!entity) {
        // Edge case: empty entity → return the original match unchanged
        return match;
      }
      return buildWikiLink(type, entity);
    }));
  }

  return resultLines.join('\n');
}
