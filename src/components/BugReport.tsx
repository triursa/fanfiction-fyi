import { useState, useRef, useEffect } from 'preact/hooks';

export default function BugReport() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
    if (!open && dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }, [open]);

  const handleClose = () => {
    setOpen(false);
    setResult(null);
    setDescription('');
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!description.trim() || submitting) return;

    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch('/api/bugs/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          page: window.location.pathname + window.location.search,
          userAgent: navigator.userAgent,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setResult({ ok: true, message: `Report submitted! Issue #${data.issue_number}` });
        setDescription('');
      } else {
        setResult({ ok: false, message: data.error || 'Something went wrong.' });
      }
    } catch {
      setResult({ ok: false, message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const charCount = description.length;
  const maxChars = 2000;

  return (
    <>
      <button
        class="bug-report-fab"
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        title="Report a bug"
      >
        🐛
      </button>

      <dialog ref={dialogRef} class="bug-report-dialog" onClose={handleClose}>
        <div class="bug-report-content">
          <div class="bug-report-header">
            <h2>Report a Bug</h2>
            <button class="bug-report-close" onClick={handleClose} aria-label="Close">
              ✕
            </button>
          </div>

          <p class="bug-report-page">
            Page: <code>{typeof window !== 'undefined' ? window.location.pathname : '/'}</code>
          </p>

          {result?.ok ? (
            <div class="bug-report-success">
              <p>✅ {result.message}</p>
              <button class="bug-report-btn" onClick={handleClose}>Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label class="bug-report-label" for="bug-description">
                What went wrong?
              </label>
              <textarea
                ref={textareaRef}
                id="bug-description"
                class="bug-report-textarea"
                value={description}
                onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
                placeholder="Describe the bug you encountered…"
                maxLength={maxChars}
                rows={4}
                required
                disabled={submitting}
              />
              <div class="bug-report-char-count">
                {charCount}/{maxChars}
              </div>

              {result && !result.ok && (
                <p class="bug-report-error">{result.message}</p>
              )}

              <div class="bug-report-actions">
                <button type="button" class="bug-report-btn-secondary" onClick={handleClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  class="bug-report-btn"
                  disabled={!description.trim() || submitting}
                >
                  {submitting ? 'Submitting…' : 'Submit Report'}
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}