CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('comment_reply', 'kudos', 'new_chapter', 'collection_invite', 'work_featured', 'system')),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX notifications_user_unread_idx ON notifications(user_id, read);

CREATE TABLE notification_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('comment_reply', 'kudos', 'new_chapter', 'collection_invite', 'work_featured', 'system')),
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX notification_preferences_user_type_idx ON notification_preferences(user_id, type);