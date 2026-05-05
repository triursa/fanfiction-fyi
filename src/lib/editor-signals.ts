import { signal } from '@preact/signals';

export const editorMarkdown = signal('');
export const editorContent = signal('');
export const editorImageKeys = signal<string[]>([]);

/**
 * Set content in the editor from outside the Preact component tree.
 * The Editor component registers a handler on mount that actually updates the TipTap editor.
 * Callers invoke it as `editorSetContent.value?.(md)`.
 */
export const editorSetContent = signal<((mdOrHtml: string) => void) | undefined>(undefined);

/**
 * Callback invoked whenever the editor content changes.
 * Consumers (e.g. the draft page) set this to receive change notifications;
 * the Editor component reads and calls it on every update.
 */
export const editorOnContentChange = signal<((md: string) => void) | undefined>(undefined);

/**
 * Callback to trigger the image upload handler from outside the Editor.
 * Set by Editor component on mount.
 */
export const editorTriggerImageUpload = signal<(() => void) | undefined>(undefined);

/**
 * Callback to trigger the link dialog from outside the Editor.
 * Set by Editor component on mount.
 */
export const editorTriggerLinkDialog = signal<(() => void) | undefined>(undefined);