import { useEffect, useRef } from 'preact/hooks';
import { groupShortcuts, type ShortcutEntry } from '../hooks/useKeyboardShortcuts';

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
  shortcuts: ShortcutEntry[];
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function ShortcutsOverlay({ open, onClose, shortcuts }: ShortcutsOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Save and restore focus around open/close transitions
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
    } else {
      if (previousFocus.current) {
        previousFocus.current.focus();
        previousFocus.current = null;
      }
    }
  }, [open]);

  // Focus trap and Escape/? to close (? is also the global shortcut to open the overlay)
  useEffect(() => {
    if (!open) return;

    // Focus first focusable element inside the dialog
    requestAnimationFrame(() => {
      if (overlayRef.current) {
        const focusable = overlayRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length) {
          focusable[0].focus();
        } else {
          overlayRef.current.focus();
        }
      }
    });

    function onKeyDown(e: KeyboardEvent) {
      if (!overlayRef.current) return;

      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = overlayRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const groups = groupShortcuts(shortcuts);

  return (
    <div
      class="shortcuts-overlay-backdrop"
      onClick={onClose}
      aria-hidden="true"
    >
      <div
        ref={overlayRef}
        class="shortcuts-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
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