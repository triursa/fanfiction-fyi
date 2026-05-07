import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

type NotificationType = 'comment_reply' | 'kudos' | 'new_chapter' | 'collection_invite' | 'work_featured' | 'system';

interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: number | boolean;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z')).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const TYPE_ICONS: Record<NotificationType, string> = {
  comment_reply: '💬',
  kudos: '❤️',
  new_chapter: '📖',
  collection_invite: '📁',
  work_featured: '⭐',
  system: '🔔',
};

function NotificationPanel({ notifications: notifs, unreadCount, onMarkAllRead, onDelete }: {
  notifications: Notification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onDelete: (id: number) => void;
}) {
  if (notifs.length === 0) {
    return (
      <div class="notif-panel__empty">
        No notifications yet.
      </div>
    );
  }

  return (
    <div class="notif-panel__list">
      {notifs.map(n => (
        <div key={n.id} class={`notif-panel__item ${n.read ? '' : 'notif-panel__item--unread'}`}>
          <span class="notif-panel__icon">{TYPE_ICONS[n.type] || '🔔'}</span>
          <div class="notif-panel__content">
            {n.link ? (
              <a href={n.link} class="notif-panel__link">{n.title}</a>
            ) : (
              <span class="notif-panel__title">{n.title}</span>
            )}
            {n.body && (
              <p class="notif-panel__body">{n.body.length > 120 ? n.body.substring(0, 120) + '…' : n.body}</p>
            )}
            <span class="notif-panel__time">{timeAgo(n.created_at)}</span>
          </div>
          <button
            class="notif-panel__delete"
            onClick={(e: MouseEvent) => { e.stopPropagation(); onDelete(n.id); }}
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
      {unreadCount > 0 && (
        <button class="notif-panel__mark-all" onClick={onMarkAllRead}>
          Mark All Read
        </button>
      )}
    </div>
  );
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=1');
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=20');
      if (res.ok) {
        const data = await res.json();
        setNotifs(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // Poll unread count every 30s
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30_000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [open]);

  const toggleDropdown = () => {
    if (!open) fetchNotifications();
    setOpen(!open);
  };

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications/read', { method: 'PUT', headers: { 'Content-Type': 'application/json' } });
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  const deleteNotif = async (id: number) => {
    try {
      const res = await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setNotifs(prev => prev.filter(n => n.id !== id));
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch { /* ignore */ }
  };

  return (
    <div class="notif-bell" ref={panelRef}>
      <button class="notif-bell__btn" onClick={toggleDropdown} aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z" />
        </svg>
        {unreadCount > 0 && (
          <span class="notif-bell__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <div class="notif-bell__dropdown">
          <div class="notif-bell__header">
            <span class="notif-bell__title">Notifications</span>
          </div>
          {loading ? (
            <div class="notif-panel__empty">Loading…</div>
          ) : (
            <NotificationPanel
              notifications={notifs}
              unreadCount={unreadCount}
              onMarkAllRead={markAllRead}
              onDelete={deleteNotif}
            />
          )}
        </div>
      )}
    </div>
  );
}