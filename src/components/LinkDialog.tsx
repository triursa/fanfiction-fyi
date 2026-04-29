import { useState, useEffect, useRef } from 'preact/hooks';
import { h } from 'preact';

interface LinkDialogProps {
  /** Whether the dialog is visible */
  open: boolean;
  /** Initial URL value (e.g. from existing link) */
  initialUrl?: string;
  /** Called when the user confirms with a URL (empty string = remove link) */
  onConfirm: (url: string) => void;
  /** Called when the dialog is dismissed */
  onCancel: () => void;
}

export default function LinkDialog({ open, initialUrl = '', onConfirm, onCancel }: LinkDialogProps) {
  const [url, setUrl] = useState(initialUrl || 'https://');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl || 'https://');
      // Focus input on open
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialUrl]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  function handleSubmit(e: Event) {
    e.preventDefault();
    onConfirm(url);
  }

  function handleRemove() {
    onConfirm('');
  }

  return (
    <div class="link-dialog-overlay" onClick={onCancel}>
      <div class="link-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 class="link-dialog-title">Insert Link</h3>
        <form onSubmit={handleSubmit} class="link-dialog-form">
          <input
            ref={inputRef}
            type="url"
            class="m3-input"
            placeholder="https://example.com"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            autoFocus
          />
          <div class="link-dialog-actions">
            {initialUrl && (
              <button type="button" class="m3-btn-outlined" onClick={handleRemove}>
                Remove Link
              </button>
            )}
            <button type="button" class="m3-btn-text" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" class="m3-btn-filled">
              Apply
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}