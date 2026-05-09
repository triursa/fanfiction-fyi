-- Migration 0004: Add work_skin column for Work Skins feature (#22)
ALTER TABLE works ADD COLUMN work_skin TEXT NOT NULL DEFAULT 'default';