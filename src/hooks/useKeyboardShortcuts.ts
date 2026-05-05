import { useEffect, useRef } from 'preact/hooks';

/**
 * useKeyboardShortcuts — Global keyboard shortcut registry
 *
 * - Desktop only (no shortcuts on touch devices)
 * - Excludes when typing in INPUT, TEXTAREA, or contentEditable
 * - Supports scoped shortcuts (page-specific) and global shortcuts
 * - Returns registered shortcuts for overlay display
 */

export interface ShortcutDef {
  key: string;           // Key name (e.g. 'j', 'k', 'Escape', '?')
  label: string;         // Human-readable action label
  description?: string;  // Extended description
  group?: string;        // Grouping for overlay (e.g. 'Navigation', 'Reading')
  callback: () => void;
  /** Only fire when this shortcut's scope is active */
  scope?: string;
}

export interface ShortcutEntry {
  key: string;
  label: string;
  description?: string;
  group?: string;
}

function isEditable(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (el.closest('[data-testid="composer-editor"], .ProseMirror, .tiptap')) return true;
  return false;
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function useKeyboardShortcuts(
  shortcuts: ShortcutDef[],
  activeScope?: string,
): ShortcutEntry[] {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    if (isTouchDevice()) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target as EventTarget)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;
      const matched = shortcutsRef.current.find((s) => {
        if (s.scope && s.scope !== activeScope) return false;
        return s.key.toLowerCase() === key.toLowerCase();
      });

      if (matched) {
        e.preventDefault();
        matched.callback();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeScope]);

  return shortcuts.map(({ callback, ...entry }) => entry);
}

/**
 * Get shortcuts grouped for display
 */
export function groupShortcuts(entries: ShortcutEntry[]): Record<string, ShortcutEntry[]> {
  const groups: Record<string, ShortcutEntry[]> = {};
  for (const entry of entries) {
    const group = entry.group || 'General';
    if (!groups[group]) groups[group] = [];
    groups[group].push(entry);
  }
  return groups;
}