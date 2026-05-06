import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { works } from './works';
import { pseuds } from './pseuds';
import { chapters } from './works';

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type: text('type', {
    enum: ['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'],
  }).notNull(),
});

export const taggings = sqliteTable('taggings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tagId: integer('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
});

export const collections = sqliteTable('collections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  ownerPseudId: integer('owner_pseud_id').references(() => pseuds.id),
  privacy: text('privacy', {
    enum: ['open', 'moderated', 'closed', 'private', 'public', 'unrevealed'],
  })
    .notNull()
    .default('open'),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
  updatedAt: text('updated_at').notNull().default('(datetime(\'now\'))'),
});

export const collectionItems = sqliteTable('collection_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  collectionId: integer('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  addedAt: text('added_at').notNull().default('(datetime(\'now\'))'),
});

// @ts-ignore — self-referential FK (parent_id → comments.id) causes circular inference
export const comments = sqliteTable('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id')
    .notNull()
    .references(() => pseuds.id, { onDelete: 'cascade' }),
  parentId: integer('parent_id').references((): any => comments.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at'), // Set on edit (#89)
});

export const kudos = sqliteTable('kudos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id')
    .notNull()
    .references(() => pseuds.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
});

export const bookmarks = sqliteTable('bookmarks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pseudId: integer('pseud_id')
    .notNull()
    .references(() => pseuds.id, { onDelete: 'cascade' }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  notes: text('notes'),
  private: integer('private').notNull().default(0),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const series = sqliteTable('series', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
  updatedAt: text('updated_at').notNull().default('(datetime(\'now\'))'),
  creatorPseudId: integer('creator_pseud_id')
    .notNull()
    .default(0)
    .references(() => pseuds.id),
  complete: integer('complete').notNull().default(0),
});

export const serialWorks = sqliteTable('serial_works', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seriesId: integer('series_id')
    .notNull()
    .references(() => series.id, { onDelete: 'cascade' }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(1),
});

// Indexes
export const idxTagsType = index('idx_tags_type').on(tags.type);
export const idxTagsName = index('idx_tags_name').on(tags.name);
export const idxTaggingsWork = index('idx_taggings_work').on(taggings.workId);
export const idxTaggingsTag = index('idx_taggings_tag').on(taggings.tagId);
export const idxCommentsWork = index('idx_comments_work').on(comments.workId);
export const idxCommentsParent = index('idx_comments_parent').on(comments.parentId);
export const idxSeriesCreator = index('idx_series_creator').on(series.creatorPseudId);
export const idxSerialWorksSeries = index('idx_serial_works_series').on(serialWorks.seriesId, serialWorks.position);