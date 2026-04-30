import { marked } from 'marked';
import TurndownService from 'turndown';
import sanitizeHtml from 'sanitize-html';
import { parseWikiLinks } from './wiki-links';

export function markdownToHtml(md: string): string {
  // Step 1: Parse wiki-links BEFORE markdown → HTML conversion
  const withWikiLinks = parseWikiLinks(md);

  // Step 2: Convert markdown to HTML
  const raw = marked.parse(withWikiLinks, { async: false, gfm: true }) as string;

  // Step 3: Sanitize HTML, allowing wiki-link attributes and classes
  return sanitizeHtml(raw, {
    allowedTags: [
      'h1','h2','h3','h4','h5','h6','p','br','hr','blockquote','pre','code',
      'em','strong','del','a','ul','ol','li','table','thead','tbody','tr','th','td',
      'img','figure','figcaption','sup','sub','details','summary','input',
    ],
    allowedAttributes: {
      'a': ['href', 'title', 'target', 'rel', 'data-entity', 'data-type'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      'input': ['checked', 'disabled', 'type'],
      '*': ['class', 'id'],
    },
    allowedClasses: {
      'a': ['wiki-link', 'wiki-link-location', 'wiki-link-lore'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    // Allow data URIs for images only (base64 inline images from editor paste)
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    transformTags: {
      // Enforce rel="noopener noreferrer" whenever target="_blank" is present
      'a': (tagName, attribs) => ({
        tagName,
        attribs: attribs.target === '_blank'
          ? { ...attribs, rel: 'noopener noreferrer' }
          : attribs,
      }),
    },
    // Filter: only allow img tags with safe src URLs (allow-list approach)
    // exclusiveFilter returns true to REMOVE the element
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img') {
        const src = frame.attribs.src || '';
        // Remove imgs that do NOT have safe URLs (allow only /api/storage/ and https://)
        const isSafe = src.startsWith('/api/storage/') || src.startsWith('https://');
        return !isSafe; // true = remove unsafe imgs, false = keep safe imgs
      }
      return false; // false = keep all non-img elements
    },
  });
}

export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: 'atx' });
  // Preserve img tags as markdown image syntax
  return td.turndown(html);
}
