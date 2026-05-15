import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { pseuds } from './pseuds';
import { works } from './works';

// ─── Lore Entries ──────────────────────────────────────────────

export const loreEntries = sqliteTable('lore_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  content: text('content').notNull(), // markdown
  category: text('category').notNull(),
  workId: integer('work_id').references(() => works.id, { onDelete: 'set null' }),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').default(sql`(unixepoch())`),
});

// ─── Locations ────────────────────────────────────────────────

export const locations = sqliteTable('locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description').default(''),
  type: text('type', { enum: ['city', 'country', 'region', 'continent', 'other'] }).notNull(),
  parentId: integer('parent_id'),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').default(sql`(unixepoch())`),
});

// ─── Canon References (entities linked to lore & locations) ───

export const canonReferences = sqliteTable('canon_references', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entityType: text('entity_type').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  loreEntryId: integer('lore_entry_id').references(() => loreEntries.id, { onDelete: 'cascade' }),
  locationId: integer('location_id').references(() => locations.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').default(sql`(unixepoch())`),
});

// ─── Lore Edits ───────────────────────────────────────────────

export const loreEdits = sqliteTable('lore_edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  loreEntryId: integer('lore_entry_id').notNull().references(() => loreEntries.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  content: text('content').notNull(), // markdown
  reason: text('reason').default(''),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
});

// ─── Location Edits ────────────────────────────────────────────

export const locationEdits = sqliteTable('location_edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  locationId: integer('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  pseudId: integer('pseud_id').notNull().references(() => pseuds.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  reason: text('reason').default(''),
  createdAt: integer('created_at').default(sql`(unixepoch())`),
});

// ─── Indexes ──────────────────────────────────────────────────

export const idxV2LoreEntriesCategory = index('idx_v2_lore_entries_category').on(loreEntries.category);
export const idxV2LoreEntriesWorkId = index('idx_v2_lore_entries_work_id').on(loreEntries.workId);
export const idxV2LocationsType = index('idx_v2_locations_type').on(locations.type);
export const idxV2CanonRefsEntryId = index('idx_v2_canon_refs_entry_id').on(canonReferences.loreEntryId);
export const idxV2CanonRefsLocationId = index('idx_v2_canon_refs_location_id').on(canonReferences.locationId);
export const idxV2LoreEditsEntryId = index('idx_v2_lore_edits_entry_id').on(loreEdits.loreEntryId);
export const idxV2LocationEditsLocationId = index('idx_v2_location_edits_location_id').on(locationEdits.locationId);