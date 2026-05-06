import { useState, useCallback } from 'preact/hooks';

interface ReportButtonProps {
  targetType: 'work' | 'comment';
  targetId: number;
  targetLabel?: string; // work title or comment excerpt
  authed: boolean;
}

const REASONS = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'spam', label: 'Spam' },
  { value: 'copyright', label: 'Copyright violation' },
  { value: 'graphic', label: 'Graphic content' },
  { value: 'other', label: 'Other' },
] as const;

export default function ReportButton({ targetType, targetId, targetLabel, authed }: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const showModal = useCallback(() => {
    setOpen(true);
    setReason('');
    setDetails('');
    setSubmitting(false);
    setSuccess(false);
    setError('');
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!reason) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          reason,
          details: details.trim() || undefined,
        }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data: any = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to submit report');
        setSubmitting(false);
        return;
      }
      setSuccess(true);
    } catch {
      setError('Network error');
      setSubmitting(false);
    }
  }, [targetType, targetId, reason, details]);

  if (!authed) {
    return (
      <a href="/login" class="report-link">
        ⚑ Report
      </a>
    );
  }

  return (
    <>
      <button class="report-link" onClick={showModal} type="button">
        ⚑ Report
      </button>

      {open && (
        <div class="report-overlay" onClick={closeModal}>
          <div class="report-modal" onClick={(e: Event) => e.stopPropagation()}>
            {success ? (
              <div class="report-success">
                <span class="report-success-icon">✓</span>
                <p>Thank you. Your report has been submitted and will be reviewed by a moderator.</p>
                <button class="report-close-btn" onClick={closeModal}>Close</button>
              </div>
            ) : (
              <>
                <div class="report-header">
                  <h3 class="report-title">Report Content</h3>
                  <button class="report-close-x" onClick={closeModal} type="button" aria-label="Close">✕</button>
                </div>

                <div class="report-body">
                  {targetLabel && (
                    <div class="report-target-info">
                      <span class="report-target-type">{targetType === 'work' ? 'Work' : 'Comment'}:</span>
                      <span class="report-target-label">{targetLabel.length > 100 ? targetLabel.slice(0, 100) + '…' : targetLabel}</span>
                    </div>
                  )}

                  <label class="report-field">
                    <span class="report-label">Reason</span>
                    <select
                      class="report-select"
                      value={reason}
                      onChange={(e: any) => setReason(e.target.value)}
                    >
                      <option value="" disabled>Select a reason…</option>
                      {REASONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </label>

                  <label class="report-field">
                    <span class="report-label">Details <span class="report-optional">(optional)</span></span>
                    <textarea
                      class="report-textarea"
                      value={details}
                      onInput={(e: any) => setDetails(e.target.value)}
                      rows={3}
                      placeholder="Provide additional context…"
                    />
                  </label>

                  {error && <p class="report-error">{error}</p>}

                  <div class="report-actions">
                    <button class="report-cancel-btn" onClick={closeModal} type="button" disabled={submitting}>
                      Cancel
                    </button>
                    <button
                      class="report-submit-btn"
                      onClick={handleSubmit}
                      type="button"
                      disabled={!reason || submitting}
                    >
                      {submitting ? 'Submitting…' : 'Submit Report'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}