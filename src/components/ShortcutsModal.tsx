import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

interface ShortcutEntry {
  keys: string;
  action: string;
}

const shortcuts: ShortcutEntry[] = [
  { keys: 'Ctrl/Cmd + B', action: 'Bold' },
  { keys: 'Ctrl/Cmd + I', action: 'Italic' },
  { keys: 'Ctrl/Cmd + K', action: 'Link' },
  { keys: 'Ctrl/Cmd + S', action: 'Save Draft' },
  { keys: 'Ctrl/Cmd + Shift + S', action: 'Save & Publish' },
  { keys: '/', action: 'Slash commands' },
  { keys: 'Shift + ?', action: 'This help' },
  { keys: 'Escape', action: 'Exit focus mode' },
];

export default function ShortcutsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Listen for Shift+? globally
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger on Shift + ? (which is Shift + / on most keyboards)
      // Allow from editable elements too so writers can open help while typing
      if (e.shiftKey && e.key === '?') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      // Close on Escape
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Close on click outside
  const handleOverlayClick = useCallback((e: MouseEvent) => {
    if (e.target === overlayRef.current) {
      setIsOpen(false);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      class="shortcuts-overlay"
      onClick={handleOverlayClick}
    >
      <div class="shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h3 class="shortcuts-title">Keyboard Shortcuts</h3>
        <div class="shortcuts-grid">
          {shortcuts.map((s) => (
            <div key={s.keys} class="shortcuts-row">
              <kbd class="shortcuts-key">{s.keys}</kbd>
              <span class="shortcuts-action">{s.action}</span>
            </div>
          ))}
        </div>
        <div class="shortcuts-footer">
          Press <kbd>Shift + ?</kbd> or <kbd>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
