import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { pseuds } from './pseuds';
import { works, chapters } from './works';

export const characterGroups = sqliteTable('character_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});

export const characters = sqliteTable('characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  groupId: integer('group_id').references(() => characterGroups.id, { onDelete: 'set null' }),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))"),
});

export const characterAppearances = sqliteTable('character_appearances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  workId: integer('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  role: text('role', {
    enum: ['protagonist', 'antagonist', 'supporting', 'minor', 'other'],
  }).notNull().default('supporting'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
});

export const chapterReactions = sqliteTable('chapter_reactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chapterId: integer('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  reaction: text('reaction').notNull(),
  type: text('type', {
    enum: ['like', 'love', 'sad', 'angry', 'wow', 'heart'],
  }).notNull(),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
});

export const workRelations = sqliteTable('work_relations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workId: integer('work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  relatedWorkId: integer('related_work_id').notNull().references(() => works.id, { onDelete: 'cascade' }),
  relationType: text('relation_type', {
    enum: ['sequel', 'prequel', 'spinoff', 'inspired_by', 'alternate_universe', 'same_universe', 'other'],
  }).notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
});

// Indexes
export const idxV2CharactersGroup = index('idx_v2_characters_group').on(characters.groupId);
export const idxV2CharactersPseud = index('idx_v2_characters_pseud').on(characters.pseudId);
export const idxV2CharactersName = index('idx_v2_characters_name').on(characters.name);
export const idxV2CharAppearancesChar = index('idx_v2_char_appearances_char').on(characterAppearances.characterId);
export const idxV2CharAppearancesWork = index('idx_v2_char_appearances_work').on(characterAppearances.workId);
export const idxV2ChapterReactionsChapter = index('idx_v2_chapter_reactions_chapter').on(chapterReactions.chapterId);
export const idxV2ChapterReactionsPseud = index('idx_v2_chapter_reactions_pseud').on(chapterReactions.pseudId);
export const idxV2WorkRelationsWork = index('idx_v2_work_relations_work').on(workRelations.workId);
export const idxV2WorkRelationsRelatedWork = index('idx_v2_work_relations_related_work').on(workRelations.relatedWorkId);
export const idxV2WorkRelationsType = index('idx_v2_work_relations_type').on(workRelations.relationType);
