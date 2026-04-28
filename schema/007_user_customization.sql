-- fanfiction.fyi — Add user customization columns (bio, email_visibility, reading_font_size)
ALTER TABLE users ADD COLUMN bio TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN email_visibility TEXT NOT NULL DEFAULT 'private' CHECK (email_visibility IN ('public', 'mutual', 'private'));
ALTER TABLE users ADD COLUMN reading_font_size TEXT NOT NULL DEFAULT 'default' CHECK (reading_font_size IN ('small', 'default', 'large', 'xlarge'));