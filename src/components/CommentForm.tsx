import { useState, useCallback } from 'preact/hooks';
import { toSQLiteDate, type CommentData } from './CommentThread';

interface CommentPayload {
  content: string;
  work_id: number;
  parent_id?: number;
  chapter_id?: number;
}

interface CommentFormProps {
  workId: number;
  chapterId?: number | null;
  parentId?: number | null;
  replyingToName?: string | null;
  pseudId?: number | null;
  onCancelReply?: () => void;
  onPosted: (comment: CommentData) => void;
  onConfirmPost?: (tempId: number, real: CommentData) => void;
  onCancelPost?: (tempId: number) => void;
  pseudName?: string | null;
}

export default function CommentForm({
  workId,
  chapterId,
  parentId,
  replyingToName,
  pseudId,
  onCancelReply,
  onPosted,
  onConfirmPost,
  onCancelPost,
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

    const trimmed = content.trim();
    const payload: CommentPayload = { content: trimmed, work_id: workId };
    if (parentId) payload.parent_id = parentId;
    if (chapterId) payload.chapter_id = chapterId;

    // Optimistic insert: show the comment immediately before the network request
    let tempId: number | null = null;
    if (pseudId) {
      const now = new Date();
      const tempComment: CommentData = {
        // Use timestamp + random suffix to avoid same-millisecond collisions
        id: -(now.getTime() * 1000 + Math.floor(Math.random() * 1000)),
        work_id: workId,
        chapter_id: chapterId ?? null,
        pseud_id: pseudId,
        parent_id: parentId ?? null,
        content: trimmed,
        content_html: null,
        created_at: toSQLiteDate(now),
        pseud_name: pseudName ?? '',
      };
      tempId = tempComment.id;
      onPosted(tempComment);
      setContent('');
      setShowPreview(false);
    }

    try {
      const res = await fetch(`/api/works/${workId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const real: CommentData = await res.json();
        if (tempId !== null) {
          onConfirmPost?.(tempId, real);
        } else {
          onPosted(real);
          setContent('');
          setShowPreview(false);
        }
      } else {
        if (tempId !== null) {
          onCancelPost?.(tempId);
          setContent(trimmed); // Restore content so user can retry
        }
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to post comment. Please try again.');
      }
    } catch {
      if (tempId !== null) {
        onCancelPost?.(tempId);
        setContent(trimmed); // Restore content so user can retry
      }
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [content, submitting, workId, chapterId, parentId, pseudId, pseudName, onPosted, onConfirmPost, onCancelPost]);

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