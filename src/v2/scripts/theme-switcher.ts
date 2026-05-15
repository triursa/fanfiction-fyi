/**
 * Client-side theme switcher — fanfiction.fyi v2
 *
 * Reads theme from localStorage, applies M3 color tokens to :root,
 * and syncs across tabs via the storage event.
 */

import type { ThemePreset } from '../styles/themes';
import { THEME_LIST, DEFAULT_THEME, getTheme } from '../styles/themes';

const STORAGE_KEY = 'ffy-theme';

/* --------------------------------------------------------------------------
   applyTheme — set every M3 color token on <html>
   -------------------------------------------------------------------------- */
export function applyTheme(themeName: string): void {
  const theme: ThemePreset = getTheme(themeName);
  const root = document.documentElement;

  for (const [token, value] of Object.entries(theme.colors)) {
    root.style.setProperty(token, value);
  }

  // Store the active theme name as a data attribute for CSS selectors
  root.setAttribute('data-theme', theme.name);

  // Mark light/dark for components that need it
  const isLight = theme.name === 'paper';
  root.setAttribute('data-color-scheme', isLight ? 'light' : 'dark');
}

/* --------------------------------------------------------------------------
   initTheme — read persisted theme, apply before paint
   -------------------------------------------------------------------------- */
export function initTheme(): void {
  const stored = localStorage.getItem(STORAGE_KEY);
  const name = stored && THEME_LIST.some((t) => t.name === stored)
    ? stored
    : DEFAULT_THEME;
  applyTheme(name);
}

/* --------------------------------------------------------------------------
   persistTheme — save choice and apply
   -------------------------------------------------------------------------- */
export function persistTheme(themeName: string): void {
  applyTheme(themeName);
  localStorage.setItem(STORAGE_KEY, themeName);
}

/* --------------------------------------------------------------------------
   getCurrentTheme — read what's currently active
   -------------------------------------------------------------------------- */
export function getCurrentTheme(): string {
  return document.documentElement.getAttribute('data-theme') ?? DEFAULT_THEME;
}

/* --------------------------------------------------------------------------
   serializeThemeForSSR — return a <style> string that sets every token inline
   Used to embed theme into SSR HTML to avoid FOUC.
   -------------------------------------------------------------------------- */
export function serializeThemeForSSR(themeName: string): string {
  const theme = getTheme(themeName);
  const rules = Object.entries(theme.colors)
    .map(([token, value]) => `${token}:${value}`)
    .join(';');
  return `:root{${rules}}`;
}

/* --------------------------------------------------------------------------
   Cross-tab sync via storage event
   -------------------------------------------------------------------------- */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && typeof e.newValue === 'string') {
      applyTheme(e.newValue);
    }
  });
}