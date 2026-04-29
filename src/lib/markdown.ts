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
    // Validate img src — allow /api/storage/ paths and absolute https URLs
    exclusiveFilter: (frame) => {
      // For img tags, ensure src is a safe URL
      if (frame.tag === 'img') {
        const src = frame.attribs.src || '';
        // Allow /api/storage/ relative paths (our R2 proxy)
        if (src.startsWith('/api/storage/')) return true;
        // Allow absolute https URLs
        if (src.startsWith('https://')) return true;
        // Reject everything else (data: URIs, javascript:, etc.)
        return false;
      }
      return true;
    },
  });
}

export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: 'atx' });
  // Preserve img tags as markdown image syntax
  return td.turndown(html);
}
