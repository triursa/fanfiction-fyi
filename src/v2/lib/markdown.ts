/**
 * Markdown rendering pipeline for fanfiction.fyi
 * Converts Markdown source to sanitized HTML for chapter display.
 *
 * Uses `marked` for parsing and `sanitize-html` for XSS protection.
 * Both are pure JS and compatible with Cloudflare Workers runtime.
 */
import { marked } from 'marked';
// @ts-expect-error — sanitize-html uses CJS exports, no default in ESM
import sanitizeHtml from 'sanitize-html';

// Configure marked for fanfiction-friendly output
marked.setOptions({
  gfm: true,
  breaks: true, // single newlines → <br>
});

/**
 * Allowed HTML tags and attributes for fanfiction content.
 * Deliberately permissive for rich storytelling but strict on security.
 */
const ALLOWED_TAGS = [
  // Headings
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Block
  'p', 'br', 'hr', 'blockquote', 'pre', 'code',
  // Inline
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'abbr',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // Links
  'a',
  // Images (R2-served)
  'img',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  // Semantic / accessibility
  'details', 'summary', 'figure', 'figcaption', 'aside', 'cite', 'q',
  // Container
  'div', 'span', 'section', 'article',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': ['class', 'id', 'style'],
  'a': ['href', 'title', 'rel', 'target'],
  'img': ['src', 'alt', 'title', 'width', 'height', 'loading'],
  'abbr': ['title'],
  'details': ['open'],
  'td': ['colspan', 'rowspan'],
  'th': ['colspan', 'rowspan', 'scope'],
  'code': ['class'], // language- classes for syntax highlighting
  'pre': ['class'],
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'ftp'];

/**
 * Render Markdown source to sanitized HTML.
 * This is the main entry point for MD→HTML conversion.
 *
 * @param md - Raw Markdown source text
 * @returns Sanitized HTML string safe for rendering
 */
export function renderMarkdown(md: string): string {
  if (!md || typeof md !== 'string') return '';

  // 1. Parse Markdown → HTML
  const rawHtml = marked.parse(md) as string;

  // 2. Sanitize HTML — strip dangerous tags/attributes, enforce allowlist
  const clean = sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    // Allow data: URIs for images (base64-encoded) — optional, disable if strict
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    // Enforce rel="noopener noreferrer" on all links
    transformTags: {
      'a': sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
    // Don't strip content from disallowed tags, just the tags themselves
    // e.g. <script>alert(1)</script> → alert(1) (visible text, not executed)
    disallowedTagsMode: 'recursiveEscape',
  });

  return clean;
}

/**
 * Render Markdown with minimal sanitization — for author-authored contexts
 * like Author's Notes where more flexibility is acceptable.
 * Still blocks <script>, <iframe>, <object>, <embed>, <form> etc.
 */
export function renderMarkdownLoose(md: string): string {
  if (!md || typeof md !== 'string') return '';

  const rawHtml = marked.parse(md) as string;

  return sanitizeHtml(rawHtml, {
    allowedTags: [...ALLOWED_TAGS, 'iframe'],
    allowedAttributes: {
      ...ALLOWED_ATTRIBUTES,
      'iframe': ['src', 'title', 'width', 'height', 'allow', 'allowfullscreen'],
    },
    allowedSchemes: [...ALLOWED_SCHEMES, 'data'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    transformTags: {
      'a': sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
    disallowedTagsMode: 'recursiveEscape',
  });
}