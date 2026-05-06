import { useState, useCallback } from 'preact/hooks';

interface CommentFormProps {
  workId: number;
  chapterId?: number | null;
  parentId?: number | null;
  replyingToName?: string | null;
  onCancelReply?: () => void;
  onPosted: (comment: any) => void;
  pseudName?: string | null;
}

export default function CommentForm({
  workId,
  chapterId,
  parentId,
  replyingToName,
  onCancelReply,
  onPosted,
  pseudName,
}: CommentFormProps) {
  const [content, setContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: Event) => {
    e.preventDefault();
    if (!content.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    const body: any = { content: content.trim(), work_id: workId };
    if (parentId) body.parent_id = parentId;
    if (chapterId) body.chapter_id = chapterId;

    try {
      const res = await fetch(`/api/works/${workId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const comment = await res.json();
        onPosted(comment);
        setContent('');
        setShowPreview(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to post comment. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [content, submitting, workId, chapterId, parentId, onPosted]);

  return (
    <form class="comment-form" onSubmit={handleSubmit}>
      {replyingToName && (
        <div class="comment-form-header">
          <span class="reply-indicator" style="display:inline-flex;">
            Replying to <strong>{replyingToName}</strong>
            <button type="button" class="cancel-reply-btn" onClick={onCancelReply}>✕</button>
          </span>
        </div>
      )}

      <div class="comment-input-area">
        <textarea
          class="comment-textarea"
          value={content}
          onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)}
          placeholder={replyingToName ? `Reply to ${replyingToName}…` : 'Leave a comment…'}
          rows={3}
          required
          disabled={submitting}
        />

        <div class="comment-form-actions">
          <button
            type="button"
            class="comment-preview-toggle"
            onClick={() => setShowPreview(!showPreview)}
            disabled={!content.trim()}
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>

          <button
            type="submit"
            class="btn-primary comment-submit-btn"
            disabled={!content.trim() || submitting}
          >
            {submitting ? 'Posting…' : parentId ? 'Post Reply' : 'Post Comment'}
          </button>
        </div>
      </div>

      {showPreview && content.trim() && (
        <div class="comment-preview">
          <div class="comment-preview-label">Preview</div>
          <div
            class="comment-content"
            dangerouslySetInnerHTML={{
              // Basic markdown-ish preview — server renders the real thing
              __html: content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/\n/g, '<br />'),
            }}
          />
        </div>
      )}

      {error && <p class="comment-error">{error}</p>}
    </form>
  );
}