import { useEffect, useRef } from 'preact/hooks';
import { groupShortcuts, type ShortcutEntry } from '../hooks/useKeyboardShortcuts';

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
  shortcuts: ShortcutEntry[];
}

export default function ShortcutsOverlay({ open, onClose, shortcuts }: ShortcutsOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  // Trap focus
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      overlayRef.current?.focus();
    });
  }, [open]);

  if (!open) return null;

  const groups = groupShortcuts(shortcuts);

  return (
    <div
      class="shortcuts-overlay-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        ref={overlayRef}
        class="shortcuts-overlay"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div class="shortcuts-overlay-header">
          <h2 class="shortcuts-overlay-title">Keyboard Shortcuts</h2>
          <button
            class="shortcuts-overlay-close"
            onClick={onClose}
            aria-label="Close shortcuts"
          >
            ✕
          </button>
        </div>

        <div class="shortcuts-overlay-content">
          {Object.entries(groups).map(([group, items]) => (
            <div class="shortcuts-group">
              <div class="shortcuts-group-title">{group}</div>
              {items.map((item) => (
                <div class="shortcuts-row" key={item.key}>
                  <kbd class="shortcuts-key">{item.key === '?' ? '?' : item.key}</kbd>
                  <span class="shortcuts-label">{item.label}</span>
                  {item.description && (
                    <span class="shortcuts-desc">{item.description}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div class="shortcuts-overlay-footer">
          <span class="shortcuts-overlay-hint">
            Press <kbd>?</kbd> or <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}