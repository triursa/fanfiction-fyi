import { marked } from 'marked';
import TurndownService from 'turndown';
import sanitizeHtml from 'sanitize-html';

export function markdownToHtml(md: string): string {
  const raw = marked.parse(md, { async: false, gfm: true }) as string;
  return sanitizeHtml(raw, {
    allowedTags: [
      'h1','h2','h3','h4','h5','h6','p','br','hr','blockquote','pre','code',
      'em','strong','del','a','ul','ol','li','table','thead','tbody','tr','th','td',
      'img','figure','figcaption','sup','sub','details','summary','input',
    ],
    allowedAttributes: {
      'a': ['href', 'title', 'target', 'rel'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      'input': ['checked', 'disabled', 'type'],
      '*': ['class', 'id'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      // Enforce rel="noopener noreferrer" whenever target="_blank" is present
      'a': (tagName, attribs) => ({
        tagName,
        attribs: attribs.target === '_blank'
          ? { ...attribs, rel: 'noopener noreferrer' }
          : attribs,
      }),
    },
  });
}

export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: 'atx' });
  return td.turndown(html);
}
