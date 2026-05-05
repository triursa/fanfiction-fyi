import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { pseuds } from './pseuds';
import { tags } from './tags';
import { works } from './works';
import { chapters } from './works';

export const characterGroups = sqliteTable('character_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const characters = sqliteTable('characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  fandom: text('fandom'),
  groupId: integer('group_id').references(() => characterGroups.id, { onDelete: 'set null' }),
  tagId: integer('tag_id').references(() => tags.id, { onDelete: 'set null' }),
  description: text('description'),
  shortDesc: text('short_desc'),
  avatarKey: text('avatar_key'),
  aliases: text('aliases'),
  createdBy: integer('created_by').references(() => pseuds.id, { onDelete: 'set null' }),
  updatedBy: integer('updated_by').references(() => pseuds.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const characterAppearances = sqliteTable('character_appearances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  role: text('role', {
    enum: ['protagonist', 'deuteragonist', 'antagonist', 'side', 'cameo'],
  })
    .notNull()
    .default('side'),
  notes: text('notes'),
  addedBy: integer('added_by').references(() => pseuds.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const chapterReactions = sqliteTable('chapter_reactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chapterId: integer('chapter_id')
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id')
    .notNull()
    .references(() => pseuds.id, { onDelete: 'cascade' }),
  reaction: text('reaction', {
    enum: ['fire', 'cry', 'heartbreak', 'swords', 'heart', 'mindblown'],
  }).notNull(),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
});

export const workRelations = sqliteTable('work_relations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  relatedWorkId: integer('related_work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  relationType: text('relation_type', {
    enum: ['inspired_by', 'remix_of', 'response_to', 'alternate_pov', 'continuation_of', 'fix_it_for'],
  }).notNull(),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Indexes
export const idxCharactersGroup = index('idx_characters_group').on(characters.groupId);
export const idxCharactersTag = index('idx_characters_tag').on(characters.tagId);
export const idxCharactersFandom = index('idx_characters_fandom').on(characters.fandom);
export const idxCharactersName = index('idx_characters_name').on(characters.name);
export const idxCharAppearancesChar = index('idx_char_appearances_char').on(characterAppearances.characterId);
export const idxCharAppearancesWork = index('idx_char_appearances_work').on(characterAppearances.workId);
export const idxChapterReactionsChapter = index('idx_chapter_reactions_chapter').on(chapterReactions.chapterId);
export const idxChapterReactionsPseud = index('idx_chapter_reactions_pseud').on(chapterReactions.pseudId);
export const idxWorkRelationsWorkId = index('idx_work_relations_work_id').on(workRelations.workId);
export const idxWorkRelationsRelatedWorkId = index('idx_work_relations_related_work_id').on(workRelations.relatedWorkId);
export const idxWorkRelationsType = index('idx_work_relations_type').on(workRelations.relationType);