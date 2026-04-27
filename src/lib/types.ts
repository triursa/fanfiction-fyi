/**
 * Core types for fanfiction.fyi
 */

export enum UserRole {
  Admin = 'admin',
  Mod = 'mod',
  User = 'user',
}

export interface User {
  id: number;
  email: string;
  role: UserRole;
  invite_code?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Pseud {
  id: number;
  user_id: number;
  name: string;
  description?: string | null;
  icon_key?: string | null;
  created_at: string;
}

export interface Work {
  id: number;
  title: string;
  summary?: string | null;
  notes?: string | null;
  end_notes?: string | null;
  language: string;
  word_count: number;
  complete: number; // 0=wip, 1=complete
  published_at?: string | null;
  updated_at: string;
  created_at: string;
}

export interface Chapter {
  id: number;
  work_id: number;
  position: number;
  title: string;
  content_md?: string | null;
  content_html?: string | null;
  draft: number; // 1=draft, 0=posted
  word_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChapterVersion {
  id: number;
  chapter_id: number;
  version: number;
  content_md?: string | null;
  content_html?: string | null;
  note?: string | null;
  created_at: string;
}

export interface Tag {
  id: number;
  name: string;
  type: 'fandom' | 'character' | 'relationship' | 'freeform' | 'rating' | 'warning' | 'category';
}

export interface Tagging {
  id: number;
  tag_id: number;
  work_id: number;
}

export interface Creatorship {
  id: number;
  pseud_id: number;
  work_id: number;
  role: 'author' | 'coauthor' | 'translator';
}

export interface Collection {
  id: number;
  name: string;
  title: string;
  description?: string | null;
  privacy: 'open' | 'moderated' | 'closed' | 'private';
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: number;
  work_id: number;
  chapter_id?: number | null;
  pseud_id: number;
  parent_id?: number | null;
  content: string;
  created_at: string;
}

export interface Kudos {
  id: number;
  work_id: number;
  pseud_id: number;
  created_at: string;
}

export interface Bookmark {
  id: number;
  pseud_id: number;
  work_id: number;
  notes?: string | null;
  private: number;
  created_at: string;
}

export interface Session {
  id: number;
  user_id: number;
  token: string;
  created_at: string;
  expires_at: string;
}

export interface InviteCode {
  id: number;
  code: string;
  used_by?: number | null;
  created_at: string;
  used_at?: string | null;
}
