-- Schema 011: Add images column to chapters for tracking embedded media
-- Stores a JSON array of R2 keys (e.g. ["chapters/1/1745884800000-a1b2c3d4.webp"])
-- Used for cleanup when deleting a chapter or replacing images.
ALTER TABLE chapters ADD COLUMN images TEXT DEFAULT '[]';