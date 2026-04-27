import { marked } from 'marked';
import TurndownService from 'turndown';

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false, gfm: true }) as string;
}

export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: 'atx' });
  return td.turndown(html);
}
