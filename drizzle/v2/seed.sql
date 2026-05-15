/**
 * Seed script for fanfiction.fyi v2.
 *
 * Creates: founder user, default pseud, invite codes, and a basic
 * taxonomy of tags (ratings, warnings, categories, common fandoms, characters).
 *
 * Run against local D1:
 *   npx wrangler d1 execute ffy-dev --local --file=drizzle/v2/seed.sql
 *
 * Run against remote staging:
 *   npx wrangler d1 execute ffy-staging --remote --file=drizzle/v2/seed.sql
 *
 * Run against remote prod:
 *   npx wrangler d1 execute ffy-prod --remote --file=drizzle/v2/seed.sql
 */

-- ─── Founder user ────────────────────────────────────────────────
-- Password: "changeme" — bcrypt hash generated for seed purposes only.
-- CHANGE THIS IMMEDIATELY after first deploy via /settings change-password.
INSERT OR IGNORE INTO users (email, password_hash, role, display_name, approved, banned)
VALUES ('admin@fanfiction.fyi', '$2a$12$seed.placeholder.change.this.in.production.not.real', 'founder', 'Founder', 1, 0);

-- ─── Default pseud for founder ────────────────────────────────────
INSERT OR IGNORE INTO pseuds (user_id, name, is_default)
VALUES (1, 'Founder', 1);

-- ─── Invite codes ─────────────────────────────────────────────────
INSERT OR IGNORE INTO invite_codes (code, created_by_id) VALUES ('FFYI-OPEN-BETA', 1);
INSERT OR IGNORE INTO invite_codes (code, created_by_id) VALUES ('FFYI-FOUNDER-001', 1);
INSERT OR IGNORE INTO invite_codes (code, created_by_id) VALUES ('FFYI-FOUNDER-002', 1);
INSERT OR IGNORE INTO invite_codes (code, created_by_id) VALUES ('FFYI-FOUNDER-003', 1);
INSERT OR IGNORE INTO invite_codes (code, created_by_id) VALUES ('FFYI-FOUNDER-004', 1);
INSERT OR IGNORE INTO invite_codes (code, created_by_id) VALUES ('FFYI-FOUNDER-005', 1);

-- ─── Rating tags ─────────────────────────────────────────────────
INSERT OR IGNORE INTO tags (name, type) VALUES ('General Audiences', 'rating');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Teen And Up Audiences', 'rating');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Mature', 'rating');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Explicit', 'rating');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Not Rated', 'rating');

-- ─── Warning tags ─────────────────────────────────────────────────
INSERT OR IGNORE INTO tags (name, type) VALUES ('No Archive Warnings Apply', 'warning');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Graphic Depictions Of Violence', 'warning');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Major Character Death', 'warning');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Rape/Non-Con', 'warning');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Underage', 'warning');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Choose Not To Use Archive Warnings', 'warning');

-- ─── Category tags ───────────────────────────────────────────────
INSERT OR IGNORE INTO tags (name, type) VALUES ('F/F', 'category');
INSERT OR IGNORE INTO tags (name, type) VALUES ('F/M', 'category');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Gen', 'category');
INSERT OR IGNORE INTO tags (name, type) VALUES ('M/M', 'category');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Multi', 'category');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Other', 'category');

-- ─── Common fandom tags ──────────────────────────────────────────
INSERT OR IGNORE INTO tags (name, type) VALUES ('Original Work', 'fandom');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Marvel Cinematic Universe', 'fandom');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Harry Potter - J. K. Rowling', 'fandom');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Star Wars - All Media Types', 'fandom');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Supernatural', 'fandom');
INSERT OR IGNORE INTO tags (name, type) VALUES ('The Lord of the Rings - J. R. R. Tolkien', 'fandom');
INSERT OR IGNORE INTO tags (name, type) VALUES ('BTS (Bangtan Sonyeondan)', 'fandom');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Critical Role (Web Series)', 'fandom');
INSERT OR IGNORE INTO tags (name, type) VALUES ('The Witcher - All Media Types', 'fandom');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Video Game', 'fandom');

-- ─── Common character tags ───────────────────────────────────────
INSERT OR IGNORE INTO tags (name, type) VALUES ('Original Character', 'character');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Original Male Character', 'character');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Original Female Character', 'character');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Original Nonbinary Character', 'character');

-- ─── Common relationship tags ────────────────────────────────────
INSERT OR IGNORE INTO tags (name, type) VALUES ('Original Character/Original Character', 'relationship');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Original Male Character/Original Female Character', 'relationship');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Original Male Character/Original Male Character', 'relationship');
INSERT OR IGNORE INTO tags (name, type) VALUES ('Original Female Character/Original Female Character', 'relationship');