import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { pseuds } from './pseuds';

export const works = sqliteTable('works', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  summary: text('summary'),
  notes: text('notes'),
  endNotes: text('end_notes'),
  language: text('language').notNull().default('en'),
  wordCount: integer('word_count').notNull().default(0),
  complete: integer('complete').notNull().default(0),
  publishedAt: text('published_at'),
  workSkin: text('work_skin').notNull().default('default'),
  updatedAt: text('updated_at').notNull().default('(datetime(\'now\'))'),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
});

export const chapters = sqliteTable('chapters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(1),
  title: text('title').notNull().default('Chapter 1'),
  contentMd: text('content_md'),
  contentHtml: text('content_html'),
  draft: integer('draft').notNull().default(1),
  wordCount: integer('word_count').notNull().default(0),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
  updatedAt: text('updated_at').notNull().default('(datetime(\'now\'))'),
  images: text('images').default('[]'),
  mood: text('mood'),
});

export const chapterVersions = sqliteTable('chapter_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chapterId: integer('chapter_id')
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  contentMd: text('content_md'),
  contentHtml: text('content_html'),
  note: text('note'),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
});

export const creatorships = sqliteTable('creatorships', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pseudId: integer('pseud_id')
    .notNull()
    .references(() => pseuds.id, { onDelete: 'cascade' }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  role: text('role', {
    enum: ['author', 'coauthor', 'translator'],
  })
    .notNull()
    .default('author'),
});

export const readings = sqliteTable('readings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pseudId: integer('pseud_id')
    .notNull()
    .references(() => pseuds.id, { onDelete: 'cascade' }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  forLater: integer('for_later').notNull().default(0),
  lastChapter: integer('last_chapter'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Indexes
export const idxChaptersWork = index('idx_chapters_work').on(chapters.workId, chapters.position);
export const idxChapterVersions = index('idx_chapter_versions').on(chapterVersions.chapterId, chapterVersions.version);