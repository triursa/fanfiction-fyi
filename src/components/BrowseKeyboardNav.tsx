import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { useKeyboardShortcuts, type ShortcutEntry } from '../hooks/useKeyboardShortcuts';
import ShortcutsOverlay from './ShortcutsOverlay';

interface BrowseKeyboardNavProps {
  /** CSS selector for the work card elements */
  cardSelector?: string;
}

/**
 * BrowseKeyboardNav — Adds J/K work-card navigation + ? overlay to browse/list pages.
 * Renders as nothing visible except the shortcuts overlay.
 */
export default function BrowseKeyboardNav({ cardSelector = '.work-card' }: BrowseKeyboardNavProps) {
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const cardsRef = useRef<HTMLElement[]>([]);

  // Refresh card list on render
  useEffect(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(cardSelector));
    cardsRef.current = cards;
  });

  // Clear keyboard focus visual when component unmounts
  useEffect(() => {
    return () => {
      document.querySelectorAll('[data-keyboard-focused]').forEach((el) => {
        el.removeAttribute('data-keyboard-focused');
      });
    };
  }, []);

  const focusCard = useCallback((index: number) => {
    const cards = cardsRef.current;
    if (cards.length === 0) return;

    // Remove previous focus
    cards.forEach((card) => card.removeAttribute('data-keyboard-focused'));

    // Clamp index
    const clamped = Math.max(0, Math.min(index, cards.length - 1));
    setFocusedIndex(clamped);

    const card = cards[clamped];
    card.setAttribute('data-keyboard-focused', '');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    card.focus({ preventScroll: true });
  }, []);

  const goNext = useCallback(() => {
    focusCard(focusedIndex < 0 ? 0 : focusedIndex + 1);
  }, [focusedIndex, focusCard]);

  const goPrev = useCallback(() => {
    focusCard(focusedIndex < 0 ? 0 : focusedIndex - 1);
  }, [focusedIndex, focusCard]);

  const openWork = useCallback(() => {
    const cards = cardsRef.current;
    if (focusedIndex >= 0 && focusedIndex < cards.length) {
      const card = cards[focusedIndex];
      // Prefer the primary title link; fall back to first anchor in the card
      const link =
        card instanceof HTMLAnchorElement
          ? card
          : (card.querySelector<HTMLAnchorElement>('.work-card__title') ??
             card.querySelector<HTMLAnchorElement>('a'));
      if (link) {
        window.location.href = link.href;
      }
    }
  }, [focusedIndex]);

  const shortcuts = [
    { key: 'j', label: 'Next work', description: 'Move focus down', group: 'Navigation', callback: goNext },
    { key: 'k', label: 'Previous work', description: 'Move focus up', group: 'Navigation', callback: goPrev },
    { key: 'Enter', label: 'Open work', group: 'Navigation', callback: openWork },
    { key: '?', label: 'Show keyboard shortcuts', group: 'General', callback: () => setShortcutsOpen(true) },
    { key: '/', label: 'Focus search', group: 'General', callback: () => {
      const searchInput = document.querySelector<HTMLInputElement>('input[type="search"], input[name="q"], .search-input');
      if (searchInput) searchInput.focus();
    }},
  ];

  const shortcutEntries: ShortcutEntry[] = useKeyboardShortcuts(shortcuts);

  return (
    <ShortcutsOverlay
      open={shortcutsOpen}
      onClose={() => setShortcutsOpen(false)}
      shortcuts={shortcutEntries}
    />
  );
}