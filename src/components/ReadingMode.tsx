import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useScrollDirection } from '../hooks/useScrollDirection';

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
  { key: 'x-large', label: 'XL' },
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
  const [progressWidth, setProgressWidth] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shortcutsVisible, setShortcutsVisible] = useState(true);
  const [currentFontSize, setCurrentFontSize] = useState(initialFontSize);
  const [reactionState, setReactionState] = useState(() => ({
    counts: { ...initialReactionCounts },
    mine: [...initialMyReactions],
  }));

  const maxScrollPct = useRef(0);

  // ── Scroll direction hook ──
  const { direction, scrollY } = useScrollDirection(5);

  // Header visibility: visible at top, hides on scroll down, shows on scroll up
  const scrolled = scrollY > 0;
  const headerVisible = direction === 'up' || scrollY <= 0;

  // Find prev/next chapters
  const currentIndex = chapters.findIndex((c) => c.id === currentChapterId);
  const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const nextChapter = currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null;

  // ── Progress from scroll direction hook ──
  useEffect(() => {
    const winH = window.innerHeight;
    const docH = document.documentElement.scrollHeight;
    const pct = docH <= winH ? 100 : Math.min(100, (scrollY / (docH - winH)) * 100);
    setProgressWidth(pct);
  }, [scrollY]);

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

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const prevHref = prevChapter ? `/works/${workId}/read?chapter=${prevChapter.id}` : null;
    const nextHref = nextChapter ? `/works/${workId}/read?chapter=${nextChapter.id}` : null;

    function onKeyDown(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA'
      )
        return;

      // If sheet is open, only Escape is handled (by the sheet's own handler)
      if (sheetOpen) return;

      if (e.key === 'ArrowLeft' && prevHref) {
        window.location.href = prevHref;
      } else if (e.key === 'ArrowRight' && nextHref) {
        window.location.href = nextHref;
      } else if (e.key === 'Escape') {
        window.location.href = `/works/${workId}`;
      } else if (e.key === 'c' || e.key === 'C') {
        setSheetOpen((prev) => !prev);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [prevChapter, nextChapter, workId, sheetOpen]);

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
      const res = await fetch('/api/user/mood-toggle', { method: 'POST' });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      // silently fail
    }
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
        style={{ width: `${progressWidth}%` }}
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
        <kbd>←</kbd> <kbd>→</kbd> chapters · <kbd>Esc</kbd> exit reading · <kbd>C</kbd> options
      </div>
    </>
  );
}