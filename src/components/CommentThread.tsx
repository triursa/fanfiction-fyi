import { useState, useCallback, useRef } from 'preact/hooks';
import CommentForm from './CommentForm';

export interface CommentData {
  id: number;
  work_id: number;
  chapter_id: number | null;
  pseud_id: number;
  parent_id: number | null;
  content: string;
  content_html: string | null;
  created_at: string;
  pseud_name: string;
}

interface CommentThreadProps {
  workId: number;
  chapterId?: number | null;
  comments: CommentData[];
  authed: boolean;
  currentPseudId?: number | null;
  currentPseudName?: string | null;
}

function buildTree(comments: CommentData[]): Map<number, CommentData[]> {
  const tree = new Map<number, CommentData[]>();
  for (const c of comments) {
    const parent = c.parent_id ?? 0;
    if (!tree.has(parent)) tree.set(parent, []);
    tree.get(parent)!.push(c);
  }
  // Sort each level by created_at
  for (const [, children] of tree) {
    children.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return tree;
}

/**
 * Normalize a SQLite datetime string ("YYYY-MM-DD HH:MM:SS") to a Date.
 * All timestamps in this database are stored in UTC via SQLite's datetime('now')
 * or CURRENT_TIMESTAMP, so appending 'Z' is always correct here.
 */
function parseSQLiteDate(dateStr: string): Date {
  // SQLite CURRENT_TIMESTAMP uses a space instead of 'T'; replace to produce valid ISO 8601
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

/**
 * Format a Date as a SQLite-style UTC datetime string ("YYYY-MM-DD HH:MM:SS").
 * Used when creating optimistic comment entries before the server responds.
 */
export function toSQLiteDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** Escape user-supplied text for safe inline HTML rendering. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />');
}

function formatRelativeDate(dateStr: string): string {
  const date = parseSQLiteDate(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function CommentItem({
  comment,
  replies,
  depth,
  onReply,
  authed,
  treeRef,
}: {
  comment: CommentData;
  replies: CommentData[];
  depth: number;
  onReply: (parentId: number, pseudName: string) => void;
  authed: boolean;
  treeRef: Map<number, CommentData[]>;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasReplies = replies.length > 0;
  const isOptimistic = comment.id < 0;
  // Max indent depth — flatten at depth 6+
  const isDeep = depth >= 6;
  const repliesId = `comment-replies-${comment.id}`;

  return (
    <div class={`comment-item${depth > 0 ? ' comment-reply' : ''}${isDeep ? ' comment-deep' : ''}${isOptimistic ? ' optimistic' : ''}`}
         data-comment-id={comment.id}
         style={depth > 0 && !isDeep ? { marginLeft: `${Math.min(depth, 5) * 20}px` } : undefined}>
      <div class="comment-body">
        <div class="comment-header">
          <a href={`/pseuds/${comment.pseud_id}`} class="comment-author">{comment.pseud_name}</a>
          <span class="comment-date" title={parseSQLiteDate(comment.created_at).toLocaleString()}>
            {formatRelativeDate(comment.created_at)}
          </span>
        </div>
        <div
          class="comment-content"
          dangerouslySetInnerHTML={{
            __html: comment.content_html ?? escapeHtml(comment.content),
          }}
        />
        {authed && !isOptimistic && (
          <button class="reply-btn" onClick={() => onReply(comment.id, comment.pseud_name)}>Reply</button>
        )}
      </div>

      {hasReplies && (
        <button
          class="comment-expand-btn"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls={repliesId}
        >
          {expanded
            ? `Hide ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
            : `Show ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
        </button>
      )}
      {hasReplies && expanded && (
        <div id={repliesId}>
          {replies.map(reply => (
            <CommentItem
              key={reply.id}
              comment={reply}
              replies={treeRef.get(reply.id) ?? []}
              depth={depth + 1}
              onReply={onReply}
              authed={authed}
              treeRef={treeRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CommentThread({
  workId,
  chapterId,
  comments: initialComments,
  authed,
  currentPseudId,
  currentPseudName,
}: CommentThreadProps) {
  const [comments, setComments] = useState<CommentData[]>(initialComments);
  const [replyingTo, setReplyingTo] = useState<{ id: number; name: string } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const tree = buildTree(comments);
  const topLevel = tree.get(0) ?? [];

  const handleReply = useCallback((parentId: number, pseudName: string) => {
    setReplyingTo({ id: parentId, name: pseudName });
    // Scroll to the form
    threadRef.current?.querySelector('.comment-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  const handleCommentPosted = useCallback((newComment: CommentData) => {
    // Optimistic insert — add to local state immediately (temp id < 0 until confirmed)
    setComments((prev) => [...prev, newComment]);
    setReplyingTo(null);
  }, []);

  const handleConfirmPost = useCallback((tempId: number, real: CommentData) => {
    setComments((prev) => prev.map((c) => (c.id === tempId ? real : c)));
  }, []);

  const handleCancelPost = useCallback((tempId: number) => {
    setComments((prev) => prev.filter((c) => c.id !== tempId));
  }, []);

  const total = comments.length;

  return (
    <section class="comments-section" ref={threadRef}>
      <h3 class="comments-title">Comments ({total})</h3>

      {authed ? (
        <CommentForm
          workId={workId}
          chapterId={chapterId}
          parentId={replyingTo?.id ?? null}
          replyingToName={replyingTo?.name ?? null}
          onCancelReply={cancelReply}
          onPosted={handleCommentPosted}
          onConfirmPost={handleConfirmPost}
          onCancelPost={handleCancelPost}
          pseudId={currentPseudId}
          pseudName={currentPseudName}
        />
      ) : (
        <p class="login-prompt"><a href="/login">Sign in</a> to leave a comment.</p>
      )}

      <div class="comments-thread">
        {topLevel.length === 0 && (
          <p class="comments-empty">No comments yet. Be the first to share your thoughts!</p>
        )}
        {topLevel.map((comment) => {
          const replies = tree.get(comment.id) ?? [];
          return (
            <CommentItem
              key={comment.id}
              comment={comment}
              replies={replies}
              depth={0}
              onReply={handleReply}
              authed={authed}
              treeRef={tree}
            />
          );
        })}
      </div>
    </section>
  );
}