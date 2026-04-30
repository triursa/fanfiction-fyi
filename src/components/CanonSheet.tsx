import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

// ── Types ──

interface CanonEntry {
  type: 'lore' | 'location';
  id: number;
  title: string;
  slug?: string;
  category?: string;
  body_html: string;
  fandom_name?: string;
  works?: { id: number; title: string }[];
  breadcrumb?: { id: number; name: string; slug: string }[];
  children?: { id: number; name: string; slug: string }[];
}

interface CanonSheetProps {
  open: boolean;
  canonType: 'lore' | 'location' | null;
  canonId: number | null;
  onClose: () => void;
}

// ── Category display names ──
const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  magic: 'Magic',
  history: 'History',
  organization: 'Organization',
  concept: 'Concept',
  item: 'Item',
  event: 'Event',
  culture: 'Culture',
  species: 'Species',
};

// ── Loading skeleton ──
function LoadingSkeleton() {
  return (
    <div class="canon-sheet-loading">
      <div class="canon-sheet-skeleton canon-sheet-skeleton-title" />
      <div class="canon-sheet-skeleton canon-sheet-skeleton-badge" />
      <div class="canon-sheet-skeleton canon-sheet-skeleton-line" />
      <div class="canon-sheet-skeleton canon-sheet-skeleton-line short" />
      <div class="canon-sheet-skeleton canon-sheet-skeleton-line" />
    </div>
  );
}

// ── Main Component ──
export default function CanonSheet({ open, canonType, canonId, onClose }: CanonSheetProps) {
  const [entry, setEntry] = useState<CanonEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Fetch canon entry when opened
  useEffect(() => {
    if (!open || !canonType || !canonId) {
      setEntry(null);
      return;
    }

    setLoading(true);
    setError(null);
    setEntry(null);

    fetch(`/api/canon/lookup?type=${canonType}&id=${canonId}`)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load ${canonType}`);
        return res.json();
      })
      .then(data => {
        setEntry(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Failed to load canon entry');
        setLoading(false);
      });
  }, [open, canonType, canonId]);

  // Focus trap & escape handling
  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement as HTMLElement;

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
      if (previousFocus.current) {
        previousFocus.current.focus();
      }
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        class={`canon-sheet-backdrop${open ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        class={`canon-sheet${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={entry ? entry.title : 'Canon entry'}
      >
        {/* Drag handle (mobile bottom sheet) */}
        <div class="canon-sheet-drag-handle" aria-hidden="true">
          <div class="canon-sheet-drag-indicator" />
        </div>

        {/* Header */}
        <div class="canon-sheet-header">
          {entry && (
            <span class="canon-sheet-type-badge">
              {entry.type === 'lore' ? '📖 Lore' : '📍 Location'}
            </span>
          )}
          <button
            class="canon-sheet-close"
            onClick={onClose}
            aria-label="Close canon entry"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div class="canon-sheet-content">
          {loading && <LoadingSkeleton />}

          {error && (
            <div class="canon-sheet-error">
              <p>Couldn't load this entry.</p>
              <p class="canon-sheet-error-detail">{error}</p>
            </div>
          )}

          {entry && !loading && (
            <>
              {/* Title */}
              <h2 class="canon-sheet-title">{entry.title}</h2>

              {/* Meta badges */}
              <div class="canon-sheet-meta">
                {entry.type === 'lore' && entry.category && (
                  <span class="canon-sheet-badge">{CATEGORY_LABELS[entry.category] || entry.category}</span>
                )}
                {entry.fandom_name && (
                  <span class="canon-sheet-badge fandom">{entry.fandom_name}</span>
                )}
              </div>

              {/* Breadcrumb (locations) */}
              {entry.type === 'location' && entry.breadcrumb && entry.breadcrumb.length > 0 && (
                <div class="canon-sheet-breadcrumb">
                  {entry.breadcrumb.map((crumb, i) => (
                    <>
                      {i > 0 && <span class="canon-sheet-breadcrumb-sep">›</span>}
                      <a href={`/canon/locations/${crumb.id}`} class="canon-sheet-breadcrumb-link">
                        {crumb.name}
                      </a>
                    </>
                  ))}
                  <span class="canon-sheet-breadcrumb-sep">›</span>
                  <span class="canon-sheet-breadcrumb-current">{entry.title}</span>
                </div>
              )}

              {/* Body */}
              {entry.body_html && (
                <div
                  class="canon-sheet-body prose-content"
                  dangerouslySetInnerHTML={{ __html: entry.body_html }}
                />
              )}
              {!entry.body_html && (
                <p class="canon-sheet-empty">No detailed description yet.</p>
              )}

              {/* Child locations */}
              {entry.type === 'location' && entry.children && entry.children.length > 0 && (
                <div class="canon-sheet-children">
                  <h3 class="canon-sheet-section-title">Places within</h3>
                  <ul class="canon-sheet-child-list">
                    {entry.children.map(child => (
                      <li key={child.id}>
                        <a href={`/canon/locations/${child.id}`}>{child.name}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Referenced Works */}
              {entry.works && entry.works.length > 0 && (
                <div class="canon-sheet-works">
                  <h3 class="canon-sheet-section-title">
                    {entry.type === 'lore' ? 'Works referencing this' : 'Works set here'}
                  </h3>
                  <ul class="canon-sheet-work-list">
                    {entry.works.map(work => (
                      <li key={work.id}>
                        <a href={`/works/${work.id}`}>{work.title}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Full page link */}
              <div class="canon-sheet-footer">
                <a
                  href={entry.type === 'lore'
                    ? `/canon/lore/${entry.id}`
                    : `/canon/locations/${entry.id}`}
                  class="canon-sheet-full-link"
                >
                  View full page →
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}