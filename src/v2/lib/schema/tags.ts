import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { works } from './works';
import { pseuds } from './pseuds';
import { chapters } from './works';

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['fandom', 'character', 'relationship', 'freeform', 'rating', 'warning', 'category'] }).notNull(),
  description: text('description'),
  canonical: integer('canonical').notNull().default(0),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
}, (table) => ({
  uniqueNameType: uniqueIndex('idx_v2_tags_name_type').on(table.name, table.type),
}));

export const taggings = sqliteTable('taggings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  workId: integer('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
});

export const kudos = sqliteTable('kudos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workId: integer('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
}, (table) => ({
  uniqueWorkPseud: uniqueIndex('idx_v2_kudos_work_pseud').on(table.workId, table.pseudId),
}));

export const bookmarks = sqliteTable('bookmarks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  workId: integer('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  notes: text('notes'),
  private: integer('private').notNull().default(0),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
}, (table) => ({
  uniquePseudWork: uniqueIndex('idx_v2_bookmarks_pseud_work').on(table.pseudId, table.workId),
}));

// Indexes
export const idxV2TagsType = index('idx_v2_tags_type').on(tags.type);
export const idxV2TagName = index('idx_v2_tags_name').on(tags.name);
export const idxV2TaggingsWork = index('idx_v2_taggings_work').on(taggings.workId);
export const idxV2TaggingsTag = index('idx_v2_taggings_tag').on(taggings.tagId);