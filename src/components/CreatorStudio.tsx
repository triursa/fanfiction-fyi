import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

// ── Types ──────────────────────────────────────────────

interface StudioWork {
  id: number;
  title: string;
  summary: string | null;
  word_count: number;
  complete: number;
  published_at: string | null;
  updated_at: string;
  chapter_count: number;
  pseuds: { name: string; icon_key: string | null }[];
  tags: { name: string; type: string }[];
}

type ViewTab = 'drafts' | 'published' | 'collections';

// ── M3 Segmented Button ────────────────────────────────

function SegmentedButton({ options, value, onChange }: {
  options: { value: ViewTab; label: string; icon?: string }[];
  value: ViewTab;
  onChange: (v: ViewTab) => void;
}) {
  return (
    <div class="studio-segmented" role="radiogroup" aria-label="Creator view">
      {options.map(opt => (
        <button
          type="button"
          class={`seg-btn ${opt.value === value ? 'seg-btn--active' : ''}`}
          role="radio"
          aria-checked={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon && <span class="seg-btn-icon">{opt.icon}</span>}
          <span class="seg-btn-label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Swipable List Item ─────────────────────────────────

function SwipeableWorkItem({ work, onPublish, onDelete }: {
  work: StudioWork;
  onPublish: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const itemRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const currentX = useRef(0);
  const isDragging = useRef(false);
  const SWIPE_THRESHOLD = 80;
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  );

  const handleTouchStart = useCallback((e: TouchEvent) => {
    startX.current = e.touches[0].clientX;
    currentX.current = 0;
    isDragging.current = true;
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    currentX.current = dx;
    if (itemRef.current) {
      const clamped = Math.max(-160, Math.min(160, dx));
      itemRef.current.style.transform = `translateX(${clamped}px)`;
      itemRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
    if (!itemRef.current) return;
    const dx = currentX.current;

    if (dx > SWIPE_THRESHOLD) {
      // Swipe right → publish
      itemRef.current.style.transform = 'translateX(120px)';
      itemRef.current.style.transition = `transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard)`;
      onPublish(work.id);
    } else if (dx < -SWIPE_THRESHOLD) {
      // Swipe left → delete
      itemRef.current.style.transform = 'translateX(-120px)';
      itemRef.current.style.transition = `transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard)`;
      onDelete(work.id);
    } else {
      // Snap back
      itemRef.current.style.transform = 'translateX(0)';
      itemRef.current.style.transition = `transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard)`;
    }
  }, [work.id, onPublish, onDelete]);

  const fandomTags = work.tags.filter(t => t.type === 'fandom');
  const isWip = work.complete === 0;
  const isDraft = !work.published_at;

  return (
    <div class="swipeable-item-wrapper">
      {/* Left action (publish — revealed on swipe right) */}
      <div class="swipe-action swipe-action--left" aria-hidden="true">
        <span class="swipe-action-icon">✓</span>
        <span class="swipe-action-label">Publish</span>
      </div>
      {/* Right action (delete — revealed on swipe left) */}
      <div class="swipe-action swipe-action--right" aria-hidden="true">
        <span class="swipe-action-icon">✕</span>
        <span class="swipe-action-label">Delete</span>
      </div>
      {/* The draggable card itself */}
      <div
        ref={itemRef}
        class="work-list-item"
        onTouchStart={prefersReducedMotion.current ? undefined : handleTouchStart}
        onTouchMove={prefersReducedMotion.current ? undefined : handleTouchMove}
        onTouchEnd={prefersReducedMotion.current ? undefined : handleTouchEnd}
      >
        <div class="work-list-item__main">
          <a href={`/works/${work.id}`} class="work-list-item__title">{work.title}</a>
          <div class="work-list-item__meta">
            <span>{work.word_count.toLocaleString()} words</span>
            <span>·</span>
            <span>{work.chapter_count} ch</span>
            <span>·</span>
            <span class={`status-badge ${isDraft ? 'status-badge--draft' : isWip ? 'status-badge--wip' : 'status-badge--complete'}`}>
              {isDraft ? 'Draft' : isWip ? 'WIP' : 'Complete'}
            </span>
          </div>
          {work.summary && (
            <p class="work-list-item__summary">{work.summary.length > 120 ? work.summary.slice(0, 120) + '…' : work.summary}</p>
          )}
          {fandomTags.length > 0 && (
            <div class="work-list-item__tags">
              {fandomTags.map(t => <span class="tag-pill">{t.name}</span>)}
            </div>
          )}
        </div>
        <div class="work-list-item__actions">
          <a href={`/works/${work.id}/draft`} class="action-btn action-btn--edit" title="Edit">✎</a>
          <a href={`/works/${work.id}/settings`} class="action-btn action-btn--settings" title="Settings">⚙</a>
        </div>
      </div>
    </div>
  );
}

// ── Desktop List Item (no swipe, uses buttons) ─────────

function DesktopWorkItem({ work, tab, onPublish, onDelete }: {
  work: StudioWork;
  tab: ViewTab;
  onPublish: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const fandomTags = work.tags.filter(t => t.type === 'fandom');
  const isWip = work.complete === 0;
  const isDraft = !work.published_at;

  return (
    <div class="work-list-item work-list-item--desktop">
      <div class="work-list-item__main">
        <a href={`/works/${work.id}`} class="work-list-item__title">{work.title}</a>
        <div class="work-list-item__meta">
          <span>{work.word_count.toLocaleString()} words</span>
          <span>·</span>
          <span>{work.chapter_count} ch</span>
          <span>·</span>
          <span class={`status-badge ${isDraft ? 'status-badge--draft' : isWip ? 'status-badge--wip' : 'status-badge--complete'}`}>
            {isDraft ? 'Draft' : isWip ? 'WIP' : 'Complete'}
          </span>
          <span>·</span>
          <span class="work-list-item__date">Updated {new Date(work.updated_at).toLocaleDateString()}</span>
        </div>
        {work.summary && (
          <p class="work-list-item__summary">{work.summary.length > 200 ? work.summary.slice(0, 200) + '…' : work.summary}</p>
        )}
        {fandomTags.length > 0 && (
          <div class="work-list-item__tags">
            {fandomTags.map(t => <span class="tag-pill">{t.name}</span>)}
          </div>
        )}
      </div>
      <div class="work-list-item__actions">
        <a href={`/works/${work.id}/draft`} class="action-btn action-btn--edit" title="Edit">✎</a>
        <a href={`/works/${work.id}/settings`} class="action-btn action-btn--settings" title="Settings">⚙</a>
        {tab === 'drafts' && (
          <button type="button" class="action-btn action-btn--publish" title="Publish" onClick={() => onPublish(work.id)}>Publish</button>
        )}
        <button type="button" class="action-btn action-btn--delete" title="Delete" onClick={() => onDelete(work.id)}>✕</button>
      </div>
    </div>
  );
}

// ── Main Creator Studio Component ─────────────────────

export default function CreatorStudio() {
  const [tab, setTab] = useState<ViewTab>('drafts');
  const [works, setWorks] = useState<StudioWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showFabMenu, setShowFabMenu] = useState(false);

  // Responsive breakpoint detection
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Fetch works based on tab
  const fetchWorks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = tab === 'drafts' ? 'draft' : tab === 'published' ? 'published' : 'collection';
      const res = await fetch(`/api/works/mine?status=${statusParam}`);
      if (!res.ok) {
        const errData: any = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to load works');
      }
      const data: any = await res.json();
      setWorks(data.works || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load works');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchWorks(); }, [fetchWorks]);

  // Publish handler — publish all draft chapters of a work
  const handlePublish = useCallback(async (workId: number) => {
    try {
      // First get chapters
      const chRes = await fetch(`/api/works/${workId}/chapters`);
      if (!chRes.ok) throw new Error('Failed to fetch chapters');
      const chapters: any[] = await chRes.json();

      // Publish each draft chapter
      for (const ch of chapters) {
        if (ch.draft === 1) {
          await fetch(`/api/works/${workId}/chapters/${ch.id}/publish`, { method: 'POST' });
        }
      }
      // Refresh list
      fetchWorks();
    } catch (err: any) {
      setError(err.message || 'Failed to publish');
    }
  }, [fetchWorks]);

  // Delete handler
  const handleDelete = useCallback(async (workId: number) => {
    if (!confirm('Delete this work? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/works/${workId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      fetchWorks();
    } catch (err: any) {
      setError(err.message || 'Failed to delete');
    }
  }, [fetchWorks]);

  const tabs = [
    { value: 'drafts' as ViewTab, label: 'Drafts', icon: '📝' },
    { value: 'published' as ViewTab, label: 'Published', icon: '📖' },
    { value: 'collections' as ViewTab, label: 'Collections', icon: '📁' },
  ];

  return (
    <section class="creator-studio">
      <header class="studio-header">
        <h1 class="studio-title">Creator Studio</h1>
        <p class="studio-subtitle">Your writing workspace — manage drafts, published works, and collections.</p>
      </header>

      <SegmentedButton options={tabs} value={tab} onChange={setTab} />

      {error && (
        <div class="studio-error" role="alert">
          <span>{error}</span>
          <button type="button" class="error-dismiss" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div class="studio-content">
        {loading && (
          <div class="studio-loading" aria-busy="true">
            <div class="skeleton-line" />
            <div class="skeleton-line" style="width: 80%" />
            <div class="skeleton-line" style="width: 60%" />
          </div>
        )}

        {!loading && works.length === 0 && (
          <div class="studio-empty">
            <p class="studio-empty-text">
              {tab === 'drafts' && 'No drafts yet. Start writing something!'}
              {tab === 'published' && 'No published works yet.'}
              {tab === 'collections' && 'No collections yet. Create one from the FAB.'}
            </p>
          </div>
        )}

        {!loading && works.length > 0 && (
          <div class="works-list" role="list">
            {works.map(w => isMobile ? (
              <SwipeableWorkItem
                key={w.id}
                work={w}
                onPublish={handlePublish}
                onDelete={handleDelete}
              />
            ) : (
              <DesktopWorkItem
                key={w.id}
                work={w}
                tab={tab}
                onPublish={handlePublish}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* M3 Extended FAB */}
      <div class="fab-container">
        <button
          type="button"
          class="studio-fab"
          aria-label="Create new"
          onClick={() => setShowFabMenu(!showFabMenu)}
        >
          <svg class="fab-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d={showFabMenu ? 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z' : 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'} />
          </svg>
          <span class="fab-label">New Work</span>
        </button>

        {showFabMenu && (
          <div class="fab-menu" role="menu">
            <a href="/works/create" class="fab-menu-item" role="menuitem">
              <span class="fab-menu-icon">📝</span>
              <span>New Work</span>
            </a>
            <a href="/series/new" class="fab-menu-item" role="menuitem">
              <span class="fab-menu-icon">📚</span>
              <span>New Series</span>
            </a>
            {tab === 'collections' && (
              <a href="/collections?new=1" class="fab-menu-item" role="menuitem">
                <span class="fab-menu-icon">📁</span>
                <span>New Collection</span>
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}