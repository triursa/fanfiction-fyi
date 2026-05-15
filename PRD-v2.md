# fanfiction.fyi 2.0 — Product Requirements Document

**Date:** May 2026  
**Author:** Tri + Director  
**Status:** Draft — pending review

---

## 1. Vision

fanfiction.fyi 2.0 is a rebuild of the original platform as a modern, AO3-inspired fanfiction archive. The v1 codebase suffered from architectural drift and incomplete features. v2 started as a clean Astro + Cloudflare stack but shipped with 5 fully-schema'd features that have zero implementation, 3 data-integrity bugs in auth checks, dead navigation links, and no Markdown rendering pipeline.

**2.0** is the product of closing those gaps, hardening what works, and shipping the features the database was already designed for.

---

## 2. Design Principles

1. **AO3-first, not Wattpad** — We're an archive. Text-centric, tag-driven, dark by default, minimal chrome.
2. **Mobile-native reading** — 60%+ traffic is mobile. The chapter reader is a first-class citizen.
3. **Invite-gated growth** — Registration requires an invite code. No open signups. This is intentional and stays.
4. **Pseuds not Profiles** — Authors have pen names (pseuds), not social profiles. One user can have many pseuds.
5. **Tag taxonomy is sacred** — Fandom, Character, Relationship, Freeform, Rating, Warning, Category. No custom tags — only canonical tags.
6. **Progressive disclosure** — Casual browsers see works. Authors get a studio. Moderators get admin tools. Each tier unlocks at the right time.

---

## 3. Architecture

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Astro 5 (SSR) | Hybrid rendering — static shell, dynamic API routes |
| UI | Preact + M3 (Material Design 3) | Island architecture for interactivity |
| Database | Cloudflare D1 (SQLite) | Drizzle ORM, local `.sqlite` for dev |
| Object Storage | Cloudflare R2 | Avatars, work images (5MB max) |
| Search | SQLite FTS5 | Full-text search on works title + summary |
| Hosting | Cloudflare Pages | `fanfiction.fyi` (prod), `staging.fanfiction.fyi` (dev) |
| Auth | Cookie sessions (SHA-256+salt) | No OAuth in v2.0 — future scope |
| Styling | 6 M3 themes + 7 reading skins | Obsidian default, terminal/parchment/etc. reading overrides |
| CI/CD | GitHub → Cloudflare Pages | Branch-based deploys |

### Development & Production Environments

| Aspect | Dev | Production |
|--------|-----|------------|
| **URL** | `staging.fanfiction.fyi` | `fanfiction.fyi` |
| **D1 Database** | `ffy-dev` (local `.sqlite`) | `ffy-production` (Cloudflare) |
| **R2 Bucket** | `ffy-dev-assets` | `ffy-production-assets` |
| **Deploy Trigger** | Push to `develop` branch | Push to `main` branch |
| **Data** | Seed data + test fixtures | Real user data |
| **Invite Codes** | Auto-seeded (6 codes) | Admin-generated only |
| **Auth** | Same middleware; localhost CORS allowed | Production CORS only |
| **Branch Protection** | None | Require PR + passing CI |

**Deployment flow:**  
`feature/*` → PR to `develop` → auto-deploy to staging → smoke test → PR to `main` → auto-deploy to production.

---

## 4. Feature Inventory — What Exists

### 4.1 Working (ship as-is with bugfixes)

| Feature | Status | Notes |
|---------|--------|-------|
| Auth (signup/login/logout/session) | ✅ Working | Invite-gated, CSRF-protected |
| Works CRUD (create, read, update, soft-delete) | ✅ Working | Draft/published states, tag assignment |
| Chapters CRUD (create, read, update, delete, reorder) | ✅ Working | Markdown storage, word count auto-calc |
| Tags API (browse, create, filter by type) | ✅ Working | 7 tag types, canonical-only |
| Search (FTS5 + tag facets) | ✅ Working | Pagination, sort, tag filters |
| Pseuds API (CRUD, public profiles) | ✅ Working | Multi-pseud per user |
| Kudos (toggle give/remove) | ⚠️ Bug | pseudId filter missing |
| Bookmarks (toggle) | ⚠️ Bug | pseudId filter missing |
| Readings (progress + mark for later) | ⚠️ Bug | Uses userId instead of pseudId |
| Comments (create, delete) | ⚠️ Bug | Deletion auth check compares pseudId to userId |
| User settings (profile, theme, reading prefs, password) | ✅ Working | |
| Admin (user management, invite codes, reports) | ✅ Working | Role-based access (admin/mod) |
| 6 M3 themes | ✅ Working | Obsidian, Ember, Forest, Aurora, Midnight, Paper |
| Reading skins | ✅ Working | 7 skins override M3 tokens for chapter reader |
| Content reports | ✅ Working | User→mod→admin pipeline |
| Integration test suite (31 tests) | ✅ Working | Auth, works, search |

### 4.2 Schema exists, no implementation (build in 2.0)

| Feature | Tables | Priority |
|---------|--------|----------|
| **Collections** | `collections`, `collection_items` | P1 — linked from homepage nav |
| **Series** | `series`, `serial_works` | P1 — linked from homepage nav |
| **Notifications** | `notifications`, `notification_preferences` | P1 — users need to know when things happen |
| **Chapter versioning** | `chapter_versions` | P2 — revision history, restore capability |
| **Audit log** | `audit_log` | P2 — admin transparency |
| **API keys** | `api_keys` | P3 — programmatic access, future scope |

### 4.3 Critical gaps (fix in 2.0)

| Gap | Impact | Priority |
|-----|--------|----------|
| **No Markdown→HTML rendering** | Chapters store `contentMd` and `contentHtml` but no pipeline converts between them | P0 — core feature broken |
| **No R2 image serving route** | `/api/storage/{key}` referenced but doesn't exist | P0 — image uploads are dead ends |
| **Dead nav links** | `/collections`, `/series` linked from homepage but no pages | P1 |
| **Missing legal pages** | `/privacy`, `/terms` declared in middleware but no pages | P2 |
| **No RSS/Atom feed** | `/feed.xml` declared in middleware but no page | P2 |
| **No password reset** | Users locked out with no recovery path | P1 |
| **No email verification** | Auto-approve on signup; invite gate is the only barrier | P2 |
| **FTS5 not synced** | No triggers keep search index in sync with inserts/updates/deletes | P0 |

---

## 5. 2.0 Feature Roadmap

### Phase 1: Critical Fixes (Week 1-2)

These are blocker-level issues that make the platform non-functional for core use cases.

- **Markdown rendering pipeline** — Server-side MD→HTML conversion on chapter save. Use `marked` or `markdown-it` with sanitizer. Store rendered HTML in `contentHtml`. Re-render on edit. Custom extensions: `[[work:123]]` cross-references, spoiler tags.
- **R2 image serving route** — `GET /api/storage/[key]` — read from R2, set correct content-type, cache headers. Signed URLs for private objects.
- **FTS5 sync triggers** — After-insert/update/delete triggers on `works` to keep `works_fts` in sync.
- **Fix auth bugs** — Kudos pseudId filter, bookmarks pseudId filter, comment deletion userId/pseudId mismatch, readings pseudId mismatch.
- **Dev/Prod environment split** — Separate `develop` → staging / `main` → production deploy pipelines with branch protection.

### Phase 2: Ship What's Schema'd (Week 3-5)

The database already has all the tables. Build the API routes and UI pages.

- **Collections** — `GET/POST /api/collections`, `GET /api/collections/[id]`, `POST/DELETE /api/collections/[id]/works`. UI: browse collections, collection detail page, create/manage in studio.
- **Series** — `GET/POST /api/series`, `GET /api/series/[id]`, `POST/DELETE /api/series/[id]/works`. UI: series detail page, create/manage in studio.
- **Notifications** — `GET /api/notifications`, `PATCH /api/notifications/[id]` (mark read), `GET/PUT /api/notifications/preferences`. UI: notification bell dropdown, preferences in settings.
- **Notification triggers:**
  - New kudos on your work
  - New comment on your work/chapter
  - Work added to collection
  - Invite code used
  - Account approved/banned/suspended
- **Password reset** — Token-based flow: `POST /api/auth/forgot-password` → email (future: just generate token+link for now) → `POST /api/auth/reset-password` → set new password.
- **Legal pages** — `/privacy`, `/terms` — static Astro pages.

### Phase 3: Harden & Polish (Week 6-8)

- **Chapter versioning UI** — View revision history, diff between versions, restore previous version.
- **Audit log** — `GET /api/admin/audit` — read-only admin view of all mod/admin actions.
- **Bookmark management** — `PUT /api/bookmarks/[id]` (edit notes/privacy), `DELETE /api/bookmarks/[id]`. UI: bookmarks page with edit/delete.
- **Reading history UI** — Clear history, remove "for later" marks.
- **RSS/Atom feed** — `GET /feed.xml` — latest 50 published works.
- **Search sort by kudos/comments** — Join comment/kudos counts into search query.
- **Co-author/translator attribution** — `POST /api/works/[id]/authors` (invite pseud, assign role). UI: manage authors in work editor.
- **Work hard-delete** — Admin-only permanent purge tool with confirmation flow.

### Phase 4: Future Scope (Post-2.0)

- API keys & programmatic access
- Email verification (replace invite-gate with email-verified + invite)
- OAuth (Google, GitHub)
- Annotations (reader highlights/notes on chapters)
- Rate limiting middleware
- Webhooks for integrations
- Import from AO3
- Reading progress sync across devices

---

## 6. Technical Specifications

### 6.1 Markdown Pipeline

```
User submits Markdown
  → Validation (max 500KB, sanitized HTML check)
  → markdown-it with plugins:
    - subscript, superscript, footnote
    - spoiler tags (CSS class toggle)
    - [[work:123]] → cross-reference link
  → HTML sanitized via DOMPurify (allowlist: p, br, em, strong, hr, blockquote, h2-h6, ul, ol, li, a, img, details, summary, span.spoiler)
  → Store contentMd (source of truth) + contentHtml (rendered)
  → FTS5: index contentMd for search
```

### 6.2 R2 Image Pipeline

```
Frontend uploads image (drag-drop in chapter editor)
  → POST /api/storage/upload — multipart/form-data
  → Validate: ≤5MB, jpeg/png/gif/webp/avif
  → Generate key: works/{workId}/{uuid}.{ext}
  → Store in R2
  → Return URL: /api/storage/{key}

GET /api/storage/{key}
  → Read from R2
  → Set Content-Type, Cache-Control: public, max-age=31536000, immutable
  → Stream response
```

### 6.3 Dev/Prod Deploy Pipeline

```
GitHub:
  main       → Cloudflare Pages production deploy (fanfiction.fyi)
  develop    → Cloudflare Pages staging deploy (staging.fanfiction.fyi)
  feature/*  → PR to develop → preview deploy

Branch protection on main:
  - Require PR (1 approval or self-review)
  - Require passing integration tests
  - Require up-to-date with main

Branch protection on develop:
  - Require PR
  - Require passing tests
```

### 6.4 FTS5 Sync Triggers

```sql
-- After insert on works
CREATE TRIGGER works_ai AFTER INSERT ON works BEGIN
  INSERT INTO works_fts(rowid, title, summary) VALUES (new.id, new.title, new.summary);
END;

-- After update on works
CREATE TRIGGER works_au AFTER UPDATE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, summary) VALUES ('delete', old.id, old.title, old.summary);
  INSERT INTO works_fts(rowid, title, summary) VALUES (new.id, new.title, new.summary);
END;

-- After delete on works
CREATE TRIGGER works_ad AFTER DELETE ON works BEGIN
  INSERT INTO works_fts(works_fts, rowid, title, summary) VALUES ('delete', old.id, old.title, old.summary);
END;
```

---

## 7. Success Metrics

| Metric | Target | How to measure |
|--------|--------|----------------|
| Integration test coverage | 31+/31 passing | `npm run test:integration` |
| Dead nav links | 0 | Manual QA |
| Markdown rendering | All chapters render correctly | Visual QA on chapter reader |
| Image upload + serve | Round-trip works | Upload → display in chapter |
| Staging/Prod deploys | Branch-based auto-deploy | Git push → live URL |
| Search freshness | FTS5 in sync within 1 write operation | Create work → immediate search hit |

---

## 8. Out of Scope for 2.0

- Social features (following, feeds, DMs)
- Monetization (tips, subscriptions, ads)
- Mobile native app
- AI-generated content tools
- Multi-tenant / self-hosted deployment
- Internationalization / localization (beyond language tag on works)