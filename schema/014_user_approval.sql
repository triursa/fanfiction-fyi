-- fanfiction.fyi — Add approval gating for new signups
-- Existing users are grandfathered in (DEFAULT 1)
-- New users (Google OAuth or invite code) start approved = 0
-- Founder is auto-approved during signup

ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;