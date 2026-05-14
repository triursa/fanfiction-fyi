import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { works } from './works';
import { chapters } from './works';
import { pseuds } from './pseuds';

export const collections = sqliteTable('collections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  ownerPseudId: integer('owner_pseud_id').references(() => pseuds.id),
  privacy: text('privacy', { enum: ['open', 'moderated', 'closed', 'private', 'public', 'unrevealed'] }).notNull().default('open'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});

export const collectionItems = sqliteTable('collection_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  collectionId: integer('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  workId: integer('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  addedAt: text('added_at').notNull().default("(datetime('now'))"),
});

export const series = sqliteTable('series', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  creatorPseudId: integer('creator_pseud_id').notNull().default(0).references(() => pseuds.id),
  complete: integer('complete').notNull().default(0),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});

export const serialWorks = sqliteTable('serial_works', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seriesId: integer('series_id').notNull().references(() => series.id, { onDelete: 'cascade' }),
  workId: integer('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(1),
});

// @ts-ignore — self-referential FK (parent_id → comments.id) causes circular inference
export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workId: integer('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id').references((): any => comments.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at'),
});

// Indexes
export const idxV2CommentsWork = index('idx_v2_comments_work').on(comments.workId);
export const idxV2CommentsParent = index('idx_v2_comments_parent').on(comments.parentId);
export const idxV2SeriesCreator = index('idx_v2_series_creator').on(series.creatorPseudId);
export const idxV2SerialWorksSeries = index('idx_v2_serial_works_series').on(serialWorks.seriesId, serialWorks.position);
