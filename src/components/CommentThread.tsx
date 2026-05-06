import { useState, useCallback, useRef } from 'preact/hooks';
import CommentForm from './CommentForm';

interface CommentData {
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

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr + 'Z'); // Assume UTC
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
  // Max indent depth — flatten at depth 6+
  const isDeep = depth >= 6;

  return (
    <div class={`comment-item${depth > 0 ? ' comment-reply' : ''}${isDeep ? ' comment-deep' : ''}`}
         data-comment-id={comment.id}
         style={depth > 0 && !isDeep ? { marginLeft: `${Math.min(depth, 5) * 20}px` } : undefined}>
      <div class="comment-body">
        <div class="comment-header">
          <a href={`/pseuds/${comment.pseud_id}`} class="comment-author">{comment.pseud_name}</a>
          <span class="comment-date" title={new Date(comment.created_at + 'Z').toLocaleString()}>
            {formatRelativeDate(comment.created_at)}
          </span>
        </div>
        <div class="comment-content" dangerouslySetInnerHTML={{ __html: comment.content_html || '' }} />
        {authed && (
          <button class="reply-btn" onClick={() => onReply(comment.id, comment.pseud_name)}>Reply</button>
        )}
      </div>

      {hasReplies && !expanded && (
        <button class="comment-expand-btn" onClick={() => setExpanded(true)}>
          Show {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </button>
      )}
      {hasReplies && expanded && replies.map(reply => (
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
    // Optimistic insert — add to local state
    setComments((prev) => [...prev, newComment]);
    setReplyingTo(null);
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