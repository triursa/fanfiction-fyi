import { signal } from '@preact/signals';

export const editorMarkdown = signal('');
export const editorContent = signal('');
export const editorImageKeys = signal<string[]>([]);

/**
 * Set content in the editor from outside the Preact component tree.
 * The Editor component registers a handler that actually updates the TipTap editor.
 * Callers should call `editorSetContent.value = md` to trigger it.
 */
export const editorSetContent = signal<((mdOrHtml: string) => void) | undefined>(undefined);

/**
 * Callback invoked whenever the editor content changes.
 * The Editor component sets this on every update; consumers can override
 * to receive change notifications.
 */
export const editorOnContentChange = signal<((md: string) => void) | undefined>(undefined);