import { marked } from 'marked';
import TurndownService from 'turndown';
import DOMPurify from 'isomorphic-dompurify';

export function markdownToHtml(md: string): string {
  const raw = marked.parse(md, { async: false, gfm: true }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'h1','h2','h3','h4','h5','h6','p','br','hr','blockquote','pre','code',
      'em','strong','del','a','ul','ol','li','table','thead','tbody','tr','th','td',
      'img','figure','figcaption','sup','sub','details','summary','input'
    ],
    ALLOWED_ATTR: ['href','src','alt','title','class','id','target','rel','width','height','checked','disabled'],
    ALLOW_DATA_ATTR: false,
  }) as string;
}

export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: 'atx' });
  return td.turndown(html);
}
