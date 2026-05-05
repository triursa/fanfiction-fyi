import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useScrollDirection } from '../hooks/useScrollDirection';
import { useKeyboardShortcuts, type ShortcutEntry } from '../hooks/useKeyboardShortcuts';
import ShortcutsOverlay from './ShortcutsOverlay';
import CanonSheet from './CanonSheet';

interface Chapter {
  id: number;
  position: number;
  title: string;
  draft: number;
  word_count: number;
}

interface ReadingModeProps {
  workId: number;
  chapters: Chapter[];
  currentChapterId: number;
  currentChapterPosition: number;
  authed: boolean;
  moodCSS: string;
  currentMood: string;
  moodDisabled: boolean;
  reactionCounts: Record<string, number>;
  myReactions: string[];
  fontSize: string;
  workTitle: string;
}

const REACTION_TYPES = ['fire', 'cry', 'heartbreak', 'swords', 'heart', 'mindblown'] as const;
const REACTION_EMOJIS: Record<string, string> = {
  fire: '🔥',
  cry: '😭',
  heartbreak: '💔',
  swords: '⚔️',
  heart: '❤️',
  mindblown: '🤯',
};

const FONT_SIZES = [
  { key: 'small', label: 'S' },
  { key: 'default', label: 'M' },
  { key: 'large', label: 'L' },
  { key: 'xlarge', label: 'XL' },
] as const;

// ── Focus Sheet Component (inline) ──
interface FocusSheetProps {
  open: boolean;
  onClose: () => void;
  chapters: Chapter[];
  currentChapterId: number;
  workId: number;
  fontSize: string;
  moodDisabled: boolean;
  onFontSizeChange: (size: string) => void;
  onMoodToggle: () => void;
  prevChapter: Chapter | null;
  nextChapter: Chapter | null;
}

function FocusSheet({
  open,
  onClose,
  chapters,
  currentChapterId,
  workId,
  fontSize,
  moodDisabled,
  onFontSizeChange,
  onMoodToggle,
  prevChapter,
  nextChapter,
}: FocusSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Focus trap & escape handling
  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement as HTMLElement;

    // Focus the first focusable element in the sheet
    requestAnimationFrame(() => {
      if (sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length) focusable[0].focus();
      }
    });

    function onKeyDown(e: KeyboardEvent) {
      if (!sheetRef.current) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus on close
      if (previousFocus.current) {
        previousFocus.current.focus();
      }
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        class={`focus-sheet-backdrop${open ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        class={`focus-sheet${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Reading options"
      >
        {/* Drag handle (mobile bottom sheet) */}
        <div class="focus-sheet-drag-handle" aria-hidden="true">
          <div class="focus-sheet-drag-indicator" />
        </div>

        {/* Close button */}
        <div class="focus-sheet-header">
          <span class="focus-sheet-title">Reading Options</span>
          <button
            class="focus-sheet-close"
            onClick={onClose}
            aria-label="Close reading options"
          >
            ✕
          </button>
        </div>

        {/* Chapters section */}
        <div class="focus-sheet-section">
          <div class="focus-sheet-section-title">Chapters</div>
          <ol class="focus-sheet-chapter-list">
            {chapters.map((c) => (
              <li
                key={c.id}
                class={`focus-sheet-chapter-item${c.id === currentChapterId ? ' current' : ''}`}
              >
                <a href={`/works/${workId}/read?chapter=${c.id}`} onClick={onClose}>
                  {c.position}. {c.title}
                </a>
                <span class="chapter-words">
                  {c.word_count?.toLocaleString() || '?'} words
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Settings section */}
        <div class="focus-sheet-section">
          <div class="focus-sheet-section-title">Settings</div>

          {/* Font size */}
          <div class="focus-sheet-setting-row">
            <span class="focus-sheet-setting-label">Font Size</span>
            <div class="focus-sheet-size-buttons">
              {FONT_SIZES.map((fs) => (
                <button
                  key={fs.key}
                  class={`focus-sheet-size-btn${fontSize === fs.key ? ' active' : ''}`}
                  onClick={() => onFontSizeChange(fs.key)}
                  aria-label={`Font size ${fs.label}`}
                >
                  {fs.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mood toggle */}
          <div class="focus-sheet-setting-row">
            <span class="focus-sheet-setting-label">Mood Engine</span>
            <button
              class={`focus-sheet-toggle-btn${moodDisabled ? '' : ' active'}`}
              onClick={onMoodToggle}
              aria-label={`Mood engine ${moodDisabled ? 'off' : 'on'}`}
            >
              {moodDisabled ? 'Off' : 'On'}
            </button>
          </div>
        </div>

        {/* Navigation section */}
        <div class="focus-sheet-section">
          <div class="focus-sheet-section-title">Navigation</div>
          <div class="focus-sheet-nav-buttons">
            {prevChapter ? (
              <a
                href={`/works/${workId}/read?chapter=${prevChapter.id}`}
                class="focus-sheet-nav-btn"
                onClick={onClose}
              >
                ← Previous Chapter
              </a>
            ) : (
              <span class="focus-sheet-nav-btn disabled">← Previous Chapter</span>
            )}
            {nextChapter ? (
              <a
                href={`/works/${workId}/read?chapter=${nextChapter.id}`}
                class="focus-sheet-nav-btn"
                onClick={onClose}
              >
                Next Chapter →
              </a>
            ) : (
              <span class="focus-sheet-nav-btn disabled">Next Chapter →</span>
            )}
          </div>
          <a href={`/works/${workId}`} class="focus-sheet-exit-btn">
            ✕ Exit Reading
          </a>
        </div>
      </div>
    </>
  );
}

export default function ReadingMode({
  workId,
  chapters,
  currentChapterId,
  currentChapterPosition,
  authed,
  moodCSS,
  currentMood,
  moodDisabled,
  reactionCounts: initialReactionCounts,
  myReactions: initialMyReactions,
  fontSize: initialFontSize,
  workTitle,
}: ReadingModeProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shortcutsVisible, setShortcutsVisible] = useState(true);
  const [currentFontSize, setCurrentFontSize] = useState(initialFontSize);
  const [reactionState, setReactionState] = useState(() => ({
    counts: { ...initialReactionCounts },
    mine: [...initialMyReactions],
  }));

  // ── Canon Deep-Dive state ──
  const [canonSheetOpen, setCanonSheetOpen] = useState(false);
  const [canonType, setCanonType] = useState<'lore' | 'location' | null>(null);
  const [canonId, setCanonId] = useState<number | null>(null);

  const maxScrollPct = useRef(0);

  // ── Scroll direction hook ──
  const { direction, progress, scrollY } = useScrollDirection(5);

  // Header visibility: visible at top, hides on scroll down, shows on scroll up
  const scrolled = scrollY > 0;
  const headerVisible = direction === 'up' || scrollY <= 0;

  // Find prev/next chapters
  const currentIndex = chapters.findIndex((c) => c.id === currentChapterId);
  const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const nextChapter = currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null;

  // ── Reaction rollback helper ──
  const revertReaction = useCallback((reaction: string, wasMine: boolean) => {
    setReactionState((prev) => {
      if (wasMine) {
        return {
          counts: { ...prev.counts, [reaction]: (prev.counts[reaction] || 0) + 1 },
          mine: [...prev.mine, reaction],
        };
      } else {
        return {
          counts: {
            ...prev.counts,
            [reaction]: Math.max(0, (prev.counts[reaction] || 0) - 1),
          },
          mine: prev.mine.filter((r) => r !== reaction),
        };
      }
    });
  }, []);

  // ── Keyboard shortcuts (via hook) ──
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);

  const handleBookmark = useCallback(async () => {
    try {
      const res = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_id: workId }),
      });
      if (res.ok) {
        // Brief visual feedback — toggle FAB icon
        const fab = document.querySelector('.focus-fab');
        if (fab) {
          fab.textContent = '✓';
          setTimeout(() => { fab.textContent = '☰'; }, 1200);
        }
      }
    } catch { /* silently fail */ }
  }, [workId]);

  const readingShortcuts = [
    { key: 'ArrowLeft', label: 'Previous chapter', group: 'Reading', callback: () => { if (prevChapter) window.location.href = `/works/${workId}/read?chapter=${prevChapter.id}`; } },
    { key: 'ArrowRight', label: 'Next chapter', group: 'Reading', callback: () => { if (nextChapter) window.location.href = `/works/${workId}/read?chapter=${nextChapter.id}`; } },
    { key: 'Escape', label: 'Exit reading', group: 'Reading', callback: () => { window.location.href = `/works/${workId}`; } },
    { key: 'c', label: 'Toggle reading options', description: 'Focus sheet', group: 'Reading', callback: () => setSheetOpen((prev) => !prev) },
    { key: 'b', label: 'Bookmark this work', group: 'Reading', callback: handleBookmark },
    { key: '?', label: 'Show keyboard shortcuts', group: 'General', callback: () => setShortcutsOverlayOpen(true) },
  ];

  // Sheet-open overrides: Escape closes sheet, C closes sheet
  const sheetShortcuts = [
    { key: 'Escape', label: 'Close options', group: 'General', callback: () => setSheetOpen(false) },
    { key: 'c', label: 'Close options', group: 'General', callback: () => setSheetOpen(false) },
    { key: '?', label: 'Show keyboard shortcuts', group: 'General', callback: () => { setSheetOpen(false); setShortcutsOverlayOpen(true); } },
  ];

  const allShortcuts = sheetOpen ? sheetShortcuts : readingShortcuts;
  const shortcutEntries: ShortcutEntry[] = useKeyboardShortcuts(allShortcuts);

  // ── Canon term delegated click listener on reading-container ──
  useEffect(() => {
    const container = document.querySelector('.reading-container');
    if (!container) return;

    container.addEventListener('click', handleCanonClick);
    return () => container.removeEventListener('click', handleCanonClick);
  }, [handleCanonClick]);

  // ── Shortcuts hint (fade out after 5s) ──
  useEffect(() => {
    setShortcutsVisible(true);
    const timer = setTimeout(() => setShortcutsVisible(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  // ── Reading progress save ──
  useEffect(() => {
    if (!authed) return;

    fetch(`/api/works/${workId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_chapter: currentChapterId }),
    }).catch(() => {});

    const interval = setInterval(() => {
      const winH = window.innerHeight;
      const docH = document.documentElement.scrollHeight;
      if (docH <= winH) return;
      const pct = Math.round((window.scrollY / (docH - winH)) * 100);
      if (pct > maxScrollPct.current) {
        maxScrollPct.current = pct;
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [authed, workId, currentChapterId]);

  // ── Reactions ──
  const handleReaction = useCallback(
    async (reaction: string) => {
      const isMine = reactionState.mine.includes(reaction);

      if (isMine) {
        setReactionState((prev) => ({
          counts: {
            ...prev.counts,
            [reaction]: Math.max(0, (prev.counts[reaction] || 0) - 1),
          },
          mine: prev.mine.filter((r) => r !== reaction),
        }));
      } else {
        setReactionState((prev) => ({
          counts: {
            ...prev.counts,
            [reaction]: (prev.counts[reaction] || 0) + 1,
          },
          mine: [...prev.mine, reaction],
        }));
      }

      try {
        const res = await fetch(
          `/api/works/${workId}/chapters/${currentChapterId}/reactions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reaction }),
          },
        );
        if (!res.ok) {
          revertReaction(reaction, isMine);
        }
      } catch {
        revertReaction(reaction, isMine);
      }
    },
    [workId, currentChapterId, reactionState.mine, reactionState.counts, revertReaction],
  );

  // ── Font size change handler ──
  const handleFontSizeChange = useCallback((size: string) => {
    setCurrentFontSize(size);
    // Update the data-font-size attribute on the nearest .reading-container
    const container = document.querySelector('.reading-container');
    if (container) {
      container.setAttribute('data-font-size', size);
    }
  }, []);

  // ── Mood toggle handler ──
  const handleMoodToggle = useCallback(async () => {
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood_disabled: !moodDisabled }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      // silently fail
    }
  }, []);

  // ── Canon deep-dive click delegation ──
  const handleCanonClick = useCallback((e: Event) => {
    const target = (e.target as HTMLElement).closest('.canon-term') as HTMLElement | null;
    if (!target) return;

    const type = target.getAttribute('data-canon-type') as 'lore' | 'location' | null;
    const id = Number(target.getAttribute('data-canon-id'));

    if (!type || !id || !Number.isFinite(id)) return;

    e.preventDefault();
    e.stopPropagation();

    setCanonType(type);
    setCanonId(id);
    setCanonSheetOpen(true);
  }, []);

  const moodAttr = moodDisabled ? 'off' : currentMood || 'none';

  return (
    <>
      {/* Mood ambient glow */}
      {moodCSS && <div class="mood-glow active" />}

      {/* Progress Bar */}
      <div
        class="reading-progress-bar"
        data-mood={moodAttr}
        style={{ width: `${progress}%` }}
      />

      {/* Top App Bar — M3 Center-Aligned */}
      <header
        class="focus-top-bar"
        data-visible={headerVisible ? 'true' : 'false'}
        data-elevated={scrolled ? 'true' : 'false'}
      >
        <div class="focus-bar-title">{workTitle}</div>
        <div class="focus-bar-meta">
          Ch. {currentChapterPosition} of {chapters.length}
        </div>
      </header>

      {/* Reaction bar — rendered here in the flow where it appears in the chapter */}
      {authed ? (
        <div class="reading-reactions" data-chapter-id={currentChapterId}>
          <span class="reading-reactions-label">React:</span>
          {REACTION_TYPES.map((reaction) => (
            <button
              class="reaction-btn"
              data-reaction={reaction}
              data-mine={reactionState.mine.includes(reaction) ? '1' : '0'}
              onClick={() => handleReaction(reaction)}
            >
              {REACTION_EMOJIS[reaction]}{' '}
              <span class="reaction-count">{reactionState.counts[reaction] || 0}</span>
            </button>
          ))}
        </div>
      ) : (
        <div class="reading-reactions">
          <span class="reading-reactions-label">
            <a href="/login">Sign in</a> to react
          </span>
        </div>
      )}

      {/* FAB — bottom-right */}
      <button
        class="focus-fab"
        onClick={() => setSheetOpen(true)}
        aria-label="Open reading options"
      >
        ☰
      </button>

      {/* Focus Sheet */}
      <FocusSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        chapters={chapters}
        currentChapterId={currentChapterId}
        workId={workId}
        fontSize={currentFontSize}
        moodDisabled={moodDisabled}
        onFontSizeChange={handleFontSizeChange}
        onMoodToggle={handleMoodToggle}
        prevChapter={prevChapter}
        nextChapter={nextChapter}
      />

      {/* Keyboard Shortcuts Hint */}
      <div class={`reading-shortcuts${shortcutsVisible ? ' visible' : ''}`}>
        <kbd>←</kbd> <kbd>→</kbd> chapters · <kbd>B</kbd> bookmark · <kbd>C</kbd> options · <kbd>?</kbd> all shortcuts
      </div>

      {/* Shortcuts Overlay */}
      <ShortcutsOverlay
        open={shortcutsOverlayOpen}
        onClose={() => setShortcutsOverlayOpen(false)}
        shortcuts={shortcutEntries}
      />

      {/* Canon Deep-Dive Sheet */}
      <CanonSheet
        open={canonSheetOpen}
        canonType={canonType}
        canonId={canonId}
        onClose={() => setCanonSheetOpen(false)}
      />
    </>
  );
}