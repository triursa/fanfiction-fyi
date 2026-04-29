import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

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
  fontSize,
  workTitle,
}: ReadingModeProps) {
  const [progressWidth, setProgressWidth] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutsVisible, setShortcutsVisible] = useState(true);
  const [reactionState, setReactionState] = useState(() => ({
    counts: { ...initialReactionCounts },
    mine: [...initialMyReactions],
  }));

  const lastScrollY = useRef(typeof window !== 'undefined' ? window.scrollY : 0);
  const maxScrollPct = useRef(0);

  // Find prev/next chapters
  const currentIndex = chapters.findIndex((c) => c.id === currentChapterId);
  const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const nextChapter = currentIndex < chapters.length - 1 ? chapters[currentIndex + 1] : null;

  // ── Progress bar & header/toolbar visibility ──
  const handleScroll = useCallback(() => {
    const winH = window.innerHeight;
    const docH = document.documentElement.scrollHeight;
    const scrolled = window.scrollY;
    const pct = docH <= winH ? 100 : Math.min(100, (scrolled / (docH - winH)) * 100);
    setProgressWidth(pct);

    const delta = scrolled - lastScrollY.current;
    if (delta < -10) setHeaderVisible(true);
    else if (delta > 10) setHeaderVisible(false);
    lastScrollY.current = scrolled;

    if (scrolled > 300) setToolbarVisible(true);
    else setToolbarVisible(false);
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const prevHref = prevChapter ? `/works/${workId}/read?chapter=${prevChapter.id}` : null;
    const nextHref = nextChapter ? `/works/${workId}/read?chapter=${nextChapter.id}` : null;

    function onKeyDown(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft' && prevHref) {
        window.location.href = prevHref;
      } else if (e.key === 'ArrowRight' && nextHref) {
        window.location.href = nextHref;
      } else if (e.key === 'Escape') {
        window.location.href = `/works/${workId}`;
      } else if (e.key === 'c' || e.key === 'C') {
        setDrawerOpen((prev) => !prev);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [prevChapter, nextChapter, workId]);

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

      // Optimistic update
      if (isMine) {
        setReactionState((prev) => ({
          counts: { ...prev.counts, [reaction]: Math.max(0, (prev.counts[reaction] || 0) - 1) },
          mine: prev.mine.filter((r) => r !== reaction),
        }));
      } else {
        setReactionState((prev) => ({
          counts: { ...prev.counts, [reaction]: (prev.counts[reaction] || 0) + 1 },
          mine: [...prev.mine, reaction],
        }));
      }

      try {
        const res = await fetch(`/api/works/${workId}/chapters/${currentChapterId}/reactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reaction }),
        });
        if (!res.ok) {
          // Revert on failure
          if (isMine) {
            setReactionState((prev) => ({
              counts: { ...prev.counts, [reaction]: (prev.counts[reaction] || 0) + 1 },
              mine: [...prev.mine, reaction],
            }));
          } else {
            setReactionState((prev) => ({
              counts: { ...prev.counts, [reaction]: Math.max(0, (prev.counts[reaction] || 0) - 1) },
              mine: prev.mine.filter((r) => r !== reaction),
            }));
          }
        }
      } catch {
        // Revert on network error
        if (isMine) {
          setReactionState((prev) => ({
            counts: { ...prev.counts, [reaction]: (prev.counts[reaction] || 0) + 1 },
            mine: [...prev.mine, reaction],
          }));
        } else {
          setReactionState((prev) => ({
            counts: { ...prev.counts, [reaction]: Math.max(0, (prev.counts[reaction] || 0) - 1) },
            mine: prev.mine.filter((r) => r !== reaction),
          }));
        }
      }
    },
    [workId, currentChapterId, reactionState.mine, reactionState.counts],
  );

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

      {/* Ambient Header */}
      <header class={`reading-header${headerVisible ? ' visible' : ''}`}>
        <button class="reading-toolbar-btn" onClick={() => setDrawerOpen(true)} aria-label="Chapters">
          ☰
        </button>
        <div class="reading-header-title">{workTitle}</div>
        <div class="reading-header-chapter">
          Ch. {currentChapterPosition} of {chapters.length}
        </div>
        <a href={`/works/${workId}`} class="reading-header-exit">
          Exit Reading
        </a>
      </header>

      {/* Chapter Drawer Overlay */}
      <div
        class={`reading-drawer-overlay${drawerOpen ? ' open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Chapter Drawer */}
      <nav class={`reading-chapters-drawer${drawerOpen ? ' open' : ''}`} aria-label="Chapter list">
        <div class="reading-drawer-title">
          <span>Chapters</span>
          <button class="reading-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close chapter list">
            ×
          </button>
        </div>
        <ol class="reading-drawer-list">
          {chapters.map((c) => (
            <li class={`reading-drawer-item${c.id === currentChapterId ? ' current' : ''}`}>
              <a href={`/works/${workId}/read?chapter=${c.id}`}>
                {c.position}. {c.title}
              </a>
              <span class="chapter-words">{c.word_count?.toLocaleString() || '?'} words</span>
            </li>
          ))}
        </ol>
      </nav>

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

      {/* Bottom Toolbar */}
      <div class={`reading-toolbar${toolbarVisible ? ' visible' : ''}`}>
        {prevChapter && (
          <a href={`/works/${workId}/read?chapter=${prevChapter.id}`} class="reading-toolbar-btn">
            ← Prev
          </a>
        )}
        <button class="reading-toolbar-btn" onClick={() => setDrawerOpen(true)}>
          ☰ Ch. {currentChapterPosition}/{chapters.length}
        </button>
        <a href={`/works/${workId}`} class="reading-toolbar-btn">
          ✕ Exit
        </a>
        {nextChapter && (
          <a href={`/works/${workId}/read?chapter=${nextChapter.id}`} class="reading-toolbar-btn">
            Next →
          </a>
        )}
      </div>

      {/* Keyboard Shortcuts Hint */}
      <div class={`reading-shortcuts${shortcutsVisible ? ' visible' : ''}`}>
        <kbd>←</kbd> <kbd>→</kbd> chapters · <kbd>Esc</kbd> exit reading · <kbd>C</kbd> chapters
      </div>
    </>
  );
}