import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { pseuds } from './pseuds';
import { tags } from './tags';
import { works } from './works';

export const loreEntries = sqliteTable('lore_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  bodyMd: text('body_md'),
  bodyHtml: text('body_html'),
  category: text('category', {
    enum: ['general', 'magic', 'history', 'organization', 'concept', 'item', 'event', 'culture', 'species'],
  })
    .notNull()
    .default('general'),
  fandomTagId: integer('fandom_tag_id').references(() => tags.id, { onDelete: 'set null' }),
  createdBy: integer('created_by').references(() => pseuds.id, { onDelete: 'set null' }),
  updatedBy: integer('updated_by').references(() => pseuds.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

// @ts-ignore — self-referential FK (parent_location_id → locations.id) causes circular inference
export const locations = sqliteTable('locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  descriptionMd: text('description_md'),
  descriptionHtml: text('description_html'),
  fandomTagId: integer('fandom_tag_id').references(() => tags.id, { onDelete: 'set null' }),
  parentLocationId: integer('parent_location_id').references((): any => locations.id, { onDelete: 'set null' }),
  createdBy: integer('created_by').references(() => pseuds.id, { onDelete: 'set null' }),
  updatedBy: integer('updated_by').references(() => pseuds.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const entityReferences = sqliteTable('entity_references', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workId: integer('work_id')
    .notNull()
    .references(() => works.id, { onDelete: 'cascade' }),
  entityType: text('entity_type', {
    enum: ['character', 'lore', 'location'],
  }).notNull(),
  entityId: integer('entity_id').notNull(),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const loreEdits = sqliteTable('lore_edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  loreEntryId: integer('lore_entry_id')
    .notNull()
    .references(() => loreEntries.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id').references(() => pseuds.id, { onDelete: 'set null' }),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const locationEdits = sqliteTable('location_edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  locationId: integer('location_id')
    .notNull()
    .references(() => locations.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id').references(() => pseuds.id, { onDelete: 'set null' }),
  field: text('field').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

// Indexes
export const idxLoreEntriesFandom = index('idx_lore_entries_fandom').on(loreEntries.fandomTagId);
export const idxLoreEntriesCategory = index('idx_lore_entries_category').on(loreEntries.category);
export const idxLoreEntriesSlug = index('idx_lore_entries_slug').on(loreEntries.slug);
export const idxLoreEntriesTitle = index('idx_lore_entries_title').on(loreEntries.title);
export const idxLocationsFandom = index('idx_locations_fandom').on(locations.fandomTagId);
export const idxLocationsParent = index('idx_locations_parent').on(locations.parentLocationId);
export const idxLocationsSlug = index('idx_locations_slug').on(locations.slug);
export const idxLocationsName = index('idx_locations_name').on(locations.name);
export const idxEntityReferencesWork = index('idx_entity_references_work').on(entityReferences.workId);
export const idxEntityReferencesEntity = index('idx_entity_references_entity').on(entityReferences.entityType, entityReferences.entityId);
export const idxLoreEditsEntry = index('idx_lore_edits_entry').on(loreEdits.loreEntryId);
export const idxLocationEditsLocation = index('idx_location_edits_location').on(locationEdits.locationId);