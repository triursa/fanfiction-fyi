import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { chapters } from './works';
import { users } from './users';

export const annotations = sqliteTable('annotations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startOffset: integer('start_offset').notNull(),
  endOffset: integer('end_offset').notNull(),
  noteText: text('note_text'),
  color: text('color', { enum: ['yellow', 'green', 'blue', 'pink', 'orange'] }).notNull().default('yellow'),
  sharedWithAuthor: integer('shared_with_author').notNull().default(0),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at'),
});

// Indexes
export const idxV2AnnotationsChapterUser = index('idx_v2_annotations_chapter_user').on(annotations.chapterId, annotations.userId);
export const idxV2AnnotationsUser = index('idx_v2_annotations_user').on(annotations.userId);
