import { signal } from '@preact/signals';

/**
 * Tracks whether a localStorage draft is available for restoration.
 * Used by the draft page to show the "Restore draft?" banner.
 */
export const localStorageDraftAvailable = signal<{ key: string; markdown: string; timestamp: number } | null>(null);

/**
 * Get the localStorage key for a given work and chapter.
 */
export function getDraftKey(workId: number | string, chapterId: number | string): string {
  return `ffy-draft-${workId}-${chapterId}`;
}

/**
 * Save a draft to localStorage.
 */
export function saveDraftToLocal(workId: number | string, chapterId: number | string, markdown: string): void {
  try {
    const key = getDraftKey(workId, chapterId);
    const data = JSON.stringify({ markdown, chapterId, timestamp: Date.now() });
    localStorage.setItem(key, data);
  } catch {
    // localStorage may be full or unavailable — silently fail
  }
}

/**
 * Load a draft from localStorage.
 */
export function loadDraftFromLocal(workId: number | string, chapterId: number | string): { markdown: string; chapterId: number; timestamp: number } | null {
  try {
    const key = getDraftKey(workId, chapterId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Clear a draft from localStorage.
 */
export function clearDraftFromLocal(workId: number | string, chapterId: number | string): void {
  try {
    const key = getDraftKey(workId, chapterId);
    localStorage.removeItem(key);
  } catch {
    // silently fail
  }
}