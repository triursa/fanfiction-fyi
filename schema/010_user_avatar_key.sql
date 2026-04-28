-- Migration 010: Add avatar_key to users table for R2-stored uploaded avatars
-- Complements existing avatar_url (external URL) with avatar_key (R2 object key)
-- When avatar_key is set, it takes precedence over avatar_url for display

ALTER TABLE users ADD COLUMN avatar_key TEXT;