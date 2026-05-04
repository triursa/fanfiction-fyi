/**
 * Core types for fanfiction.fyi
 * 
 * Table-row interfaces have been replaced by Drizzle-generated types
 * (import from @/lib/schema). Only enums and utility functions remain here.
 */

export enum UserRole {
  Founder = 'founder',
  Admin = 'admin',
  Mod = 'mod',
  User = 'user',
}

/** Role hierarchy: higher number = more privs */
export const ROLE_LEVEL: Record<UserRole, number> = {
  [UserRole.Founder]: 100,
  [UserRole.Admin]: 80,
  [UserRole.Mod]: 50,
  [UserRole.User]: 10,
};

/** Check if a role has at least the required level */
export function hasRoleLevel(role: UserRole, required: UserRole): boolean {
  return (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[required] ?? 0);
}

// ─── Character Library ────────────────────────────

export type CharacterRole = 'protagonist' | 'deuteragonist' | 'antagonist' | 'side' | 'cameo';

// ─── Canon Layer ──────────────────────────────────

export type LoreCategory = 'general' | 'magic' | 'history' | 'organization' | 'concept' | 'item' | 'event' | 'culture' | 'species';

export type EntityType = 'character' | 'lore' | 'location';