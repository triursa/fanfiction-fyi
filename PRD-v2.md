# fanfiction.fyi 2.0 — Product Requirements Document

> **Status:** Draft — May 2026  
> **Author:** Tri + Director  
> **Repository:** `github.com:triursa/fanfiction-fyi`

---

## 1. Executive Summary

fanfiction.fyi 2.0 is a ground-up rebuild of the fanfiction archive platform. The v1 codebase accumulated significant technical debt: mixed auth strategies (Google OAuth + email/password), inconsistent API patterns, and a monolithic page structure that's difficult to test and deploy incrementally. 

The 2.0 rebuild consolidates the architecture around:
- **Email/password-only auth** (invite-gated registration, no OAuth)
- **Astro server-rendered shells + Preact islands** (SEO-critical pages get server HTML; interactive bits hydrate)
- **Cloudflare D1 + R2** (three environments: dev, staging, prod)
- **Drizzle ORM** for type-safe database access
- **Material Design 3** design system

---

## 2. Current State Assessment

### 2.1 What Exists (v1)

| Layer | Status | Notes |
|-------|--------|-------|
| Drizzle schema (v1) | ✅ Complete | 13 table groups in `src/lib/schema/` |
| Drizzle schema (v2) | ✅ Complete | Clean rebuild in `src/v2/lib/schema/` — 12 modules |
| Auth lib (v2) | ✅ Complete | Email/password, sessions, invite codes, cookie helpers |
| Auth API routes (v2) | ✅ Complete | signup, login, logout, me |
| 81 API routes (v1) | ⚠️ Exists | Full CRUD for works, chapters, tags, bookmarks, kudos, collections, series, comments, annotations, search, admin, canon, characters, etc. |
| 50+ Astro pages (v1) | ⚠️ Exists | Works, chapters, search, bookmarks, settings, studio, admin, canon, characters, collections, series, tags, pseuds |
| 25+ Preact components (v1) | ⚠️ Exists | Editor, ReadingMode, SearchPage, CommentThread, WorkCard, etc. |
| M3 theme system | ✅ Exists | 6 themes, dynamic switching |
| TipTap editor | ✅ Exists | v2 with slash commands, autosave, word count, image upload |
| Wrangler config | ✅ Done | 3 environments (dev/staging/prod), D1 + R2 per env |
| Cloudflare deployment | ✅ Live | `fanfiction.fyi` on Cloudflare Pages |
| Tests | ⚠️ Minimal | Vitest configured, `test-setup.ts` exists, no substantive test suite |

### 2.2 Architectural Problems in v1

1. **Mixed auth**: Google OAuth + email/password creates two codepaths and confusing UX
2. **No invite gating in v1**: Anyone can sign up (Google OAuth bypasses invite system)
3. **Global mutable state**: `(window as any).__editorMarkdown` etc. — fragile
4. **Inconsistent API patterns**: Some routes use raw SQL, some use Drizzle, error shapes vary
5. **No dev/staging separation**: v1 deploys directly; no test-before-push pipeline
6. **Canon/characters scope creep**: Non-core features that dilute the archive focus
7. **CSP report-only**: Never promoted to enforcement

### 2.3 What v2 Removes

- ❌ Google OAuth (email/password only)
- ❌ Canon system (locations, lore, references) — out of scope for v2
- ❌ Characters system (character profiles, appearances, groups) — out of scope for v2
- ❌ Bug report client logger (`/api/bugs/report`, `/api/client-log`)
- ❌ Lineage/relationships between works — deferred to v2.1
- ❌ Recommendations engine — deferred to v2.1

---

## 3. Environment Architecture

### 3.1 Three-Environment Pipeline

```
Local Dev → Staging (fanfiction-fyi-staging) → Production (fanfiction-fyi-prod)
     ↓                    ↓                              ↓
  D1: ffy-dev      D1: ffy-staging              D1: ffy-prod
  R2: ffy-dev      R2: ffy-staging              R2: ffy-prod
```

| Environment | D1 Database | R2 Bucket | Wrangler Env | Domain |
|-------------|-------------|-----------|-------------|--------|
| Dev (default) | `ffy-dev` (`b74e9280-...`) | `ffy-dev` | (default) | `localhost:4321` |
| Staging | `ffy-staging` (`3ef61c14-...`) | `ffy-staging` | `staging` | `staging.fanfiction.fyi` |
| Production | `ffy-prod` (`9f22ddcb-...`) | `ffy-prod` | `prod` | `fanfiction.fyi` |

### 3.2 Deployment Flow

1. **Develop locally** — `npm run dev` against local D1 (`wrangler dev` + platform proxy)
2. **Push to `develop` branch** → GitHub Actions deploys to **staging** (`npx wrangler pages deploy --env staging`)
3. **Manual promotion** → Merge `develop` → `main` → deploys to **production** (`npx wrangler pages deploy --env prod`)
4. **Database migrations** — `wrangler d1 migrations apply ffy-dev --local` (dev), `--env staging` (staging), `--env prod` (production)

### 3.3 Branch Strategy

```
main ───────────────────────────────────── (production)
  └── develop ──────────────────────────── (staging)
        ├── feature/auth-pages
        ├── feature/work-crud
        └── feature/tag-autocomplete
```

- `main` = production deploys
- `develop` = staging deploys  
- Feature branches → PR to `develop` → merge triggers staging deploy
- `develop` → `main` PR → merge triggers production deploy

---

## 4. Feature Specification — v2.0

### 4.1 Authentication & Access Control

**Core principle**: Closed community, invite-only registration.

| Feature | Description | Priority |
|---------|-------------|----------|
| Email/password signup | Invite code required. Email uniqueness enforced. PBKDF2-style hashing (Web Crypto SHA-256 + salt). | P0 |
| Login | Email + password. 30-day session cookie (HttpOnly, Secure, SameSite=Lax). | P0 |
| Logout | Delete session + clear cookie. | P0 |
| Session management | One active session per user (new login invalidates old token). | P0 |
| Invite codes | Founder/admin creates codes. One use per code. Required at signup. | P0 |
| Role system | `founder` > `admin` > `mod` > `user`. Founders can create invite codes and manage roles. | P0 |
| Approval queue | New accounts can require approval (configurable). Default: auto-approve. | P1 |
| Password change | Authenticated endpoint: current password + new password. | P1 |
| Email change | Authenticated endpoint: verify new email address. | P2 |
| Account suspension | Admin can suspend until a date. User sees "suspended" message on login. | P1 |

### 4.2 Pseudonyms (Author Identities)

**Core principle**: Users can write under multiple pen names. One default pseud per user.

| Feature | Description | Priority |
|---------|-------------|----------|----------|
| Default pseud | Auto-created on signup. Display name from signup form. | P0 |
| Additional pseuds | Users can create extra pen names. Each has name, description, icon, banner, theme color. | P1 |
| Pseud profile | Public page showing pseud's works, pinned works, bio. | P1 |
| Pseud switching | When creating a work, select which pseud to attribute. | P0 |
| Avatar/icon upload | R2-backed image upload for pseud icons and banners. | P1 |

### 4.3 Works & Chapters

**Core principle**: The writing experience must be premium. This is the product differentiator.

| Feature | Description | Priority |
|---------|-------------|----------|----------|
| Create work | Title, summary, notes, end notes, language, work skin. Draft by default. | P0 |
| Edit work | Full edit of metadata. Version history on chapters. | P0 |
| Delete work | Soft delete (mark as deleted). Admin can hard delete. | P1 |
| Chapter CRUD | Add, edit, reorder, delete chapters within a work. | P0 |
| Draft/publish workflow | Chapters start as drafts. Publish work → sets `published_at` on first publish. | P0 |
| Word count | Auto-calculated on save. Displayed on work cards and in editor. | P0 |
| Work completion toggle | Mark work as complete. Readers can filter for completed works. | P0 |
| Work skins | Predefined reading themes: `default`, `typewriter`, `manuscript`, `terminal`, `parchment`. | P1 |
| Chapter versioning | Save version snapshots of chapter content. View/restore previous versions. | P2 |
| Image upload in chapters | R2-backed. Drag-and-drop in editor. Inline with markdown. | P0 |
| Epub export | Generate `.epub` from work + chapters. | P2 |
| Co-authoring | Multiple pseuds per work via `creatorships` table (author, coauthor, translator). | P1 |

### 4.4 Tags & Taxonomy

**Core principle**: AO3-style tag taxonomy. Fandom → works. Tags are the discovery backbone.

| Feature | Description | Priority |
|---------|-------------|----------|----------|
| Tag types | `fandom`, `character`, `relationship`, `freeform`, `rating`, `warning`, `category` | P0 |
| Tag autocomplete | Type-ahead search when adding tags. Returns matching existing tags. | P0 |
| Tag browse page | `/tags` — browse by type, see counts, click to see works. | P1 |
| Rating/warning enforcement | Works require exactly one rating tag. Warnings are required (even if "no warnings"). | P0 |
| Canonical tags | Admin can mark tags as canonical. Synonyms redirect to canonical. | P2 |

### 4.5 Search & Discovery

**Feature principle**: faceted search. AO3-style filtering.

| Feature | Description | Priority |
|---------|-------------|----------|----------|
| Full-text search | FTS5 on work title + summary. Porter stemmer for fuzzy matching. | P0 |
| Faceted filters | Filter by: fandom, character, relationship, rating, warning, category, complete/draft, word count range, date range. | P0 |
| Sort options | Date updated, date published, word count, kudos count, comment count. | P1 |
| Tag landing pages | `/tags/:name` — works tagged with a specific tag, filterable. | P1 |
| Homepage | Recent works, popular works, random work button. | P0 |
| Reading history | Track last-read chapter per work. "Mark for later" functionality. | P1 |
| Bookmarks | Save works with optional private notes. Public/private visibility. | P1 |

### 4.6 Social & Interaction

| Feature | Description | Priority |
|---------|-------------|----------|----------|
| Kudos | One-kudos-per-user-per-work. No downvotes. Simple appreciation signal. | P0 |
| Comments | Threaded comments on works and chapters. Author can moderate. | P0 |
| Comment moderation | Authors can delete comments on their works. Mods can delete any. | P1 |
| Collections | Group works into themed collections (open, moderated, closed, private). | P2 |
| Series | Ordered list of works by the same author(s). Display "Part X of Series Name". | P1 |

### 4.7 Reading Experience

| Feature | Description | Priority |
|---------|-------------|----------|----------|
| Reading mode | Clean, distraction-free chapter view. Font size, theme, and skin preferences. | P0 |
| Chapter navigation | Previous/next chapter, dropdown chapter list, progress indicator. | P0 |
| Work skins | Per-work theme override (typewriter, manuscript, terminal, parchment). | P1 |
| Reading preferences | Font size, skin override (respect author skin or force default). Saved per user. | P1 |
| Annotations | Inline highlights/notes on chapter text. Private by default. Optional share-with-author. | P2 |
| Offline/PWA | Service worker for offline reading. Cache recent chapters. | P2 |

### 4.8 Administration

| Feature | Description | Priority |
|---------|-------------|----------|----------|
| Admin dashboard | `/admin` — overview of users, works, reports. | P0 |
| User management | View users, change roles, suspend, ban, approve. | P0 |
| Invite code management | Create, view, revoke invite codes. Track usage. | P0 |
| Content reports | Users can report works/comments. Admin triage: resolve, dismiss. | P1 |
| Audit log | Record admin actions (role changes, suspensions, report resolutions). | P1 |
| Tag management | Merge tags, set canonical, review uncanonical tags. | P2 |

### 4.9 User Settings

| Feature | Description | Priority |
|---------|-------------|----------|----------|
| Profile editing | Display name, bio, email visibility, avatar. | P0 |
| Pseud management | Create/edit/delete pseuds. Set default. | P1 |
| Theme selection | Light, dark, obsidian, terminal, manuscript, parchment. | P1 |
| Reading preferences | Font size, skin override. | P1 |
| Notification preferences | Toggle notification types (kudos, comments, replies). | P2 |
| API keys | Generate/revoke API keys for programmatic access. Rate limit tiers: free/pro. | P2 |

### 4.10 Notifications

| Feature | Description | Priority |
|---------|-------------|----------|----------|
| Notification types | kudos_received, comment_received, comment_reply, work_updated, collection_invitation, admin_message | P1 |
| Notification bell | Header icon with unread count. Dropdown list. | P1 |
| Mark as read | Single and bulk mark-as-read. | P1 |
| Notification preferences | Per-type enable/disable. | P2 |

---

## 5. Technical Architecture

### 5.1 Stack

| Layer | Technology |
|-------|------------|
| Framework | Astro 5 (server output) |
| UI Components | Preact + signals (islands architecture) |
| Database | Cloudflare D1 (SQLite) via Drizzle ORM |
| File Storage | Cloudflare R2 |
| Auth | Email/password + session cookies (no OAuth) |
| Styling | Material Design 3 tokens + CSS custom properties |
| Editor | TipTap v2 (ProseMirror) |
| Search | D1 FTS5 |
| Deployment | Cloudflare Pages (3 environments) |
| CI/CD | GitHub Actions (lint → test → build → deploy staging → promote to prod) |

### 5.2 Directory Structure (v2)

```
src/
├── v2/                          # All new code lives here
│   ├── lib/
│   │   ├── auth.ts              # ✅ Done — password hashing, sessions, cookies
│   │   ├── db.ts                # ✅ Done — Drizzle init + getDb()
│   │   ├── validation.ts        # Zod schemas + request validation
│   │   ├── middleware.ts         # Auth middleware, CSRF, rate limiting
│   │   ├── storage.ts           # R2 upload/delete helpers
│   │   ├── markdown.ts          # marked + sanitize-html pipeline
│   │   ├── search.ts            # FTS5 query builder
│   │   └── schema/
│   │       ├── index.ts          # ✅ Done — barrel export
│   │       ├── users.ts          # ✅ Done
│   │       ├── pseuds.ts         # ✅ Done
│   │       ├── works.ts          # ✅ Done
│   │       ├── tags.ts           # ✅ Done
│   │       ├── social.ts         # ✅ Done
│   │       ├── moderation.ts     # ✅ Done
│   │       ├── notifications.ts  # ✅ Done
│   │       ├── api-keys.ts       # ✅ Done
│   │       ├── annotations.ts    # ✅ Done
│   │       └── search.ts         # ✅ Done (FTS5 virtual table)
│   ├── pages/
│   │   └── api/
│   │       ├── auth/             # ✅ Done — signup, login, logout, me
│   │       ├── works/            # CRUD + chapters + publish
│   │       ├── tags/             # CRUD + autocomplete + browse
│   │       ├── search/           # FTS5 search endpoint
│   │       ├── pseuds/           # CRUD + public profile
│   │       ├── bookmarks/        # CRUD
│   │       ├── kudos/            # Toggle + count
│   │       ├── comments/         # CRUD + threading
│   │       ├── collections/      # CRUD + items
│   │       ├── series/            # CRUD + ordering
│   │       ├── readings/          # History + mark-for-later
│   │       ├── notifications/     # CRUD + preferences
│   │       ├── user/             # Profile, password, theme, email, keys
│   │       ├── admin/            # Users, reports, audit, tags, invites
│   │       └── upload/           # R2 image upload
│   ├── components/               # Preact islands (M3-styled)
│   └── styles/                   # M3 theme tokens
├── pages/                        # Astro page routes (server-rendered shells)
│   ├── index.astro               # Homepage
│   ├── login/                    # Login page
│   ├── signup/                   # Signup page
│   ├── pending-approval/        # Post-signup pending page
│   ├── settings/                 # User settings
│   ├── works/                    # Work pages (read, edit, new)
│   ├── search/                   # Search page
│   ├── tags/                     # Tag browse
│   ├── pseuds/                   # Pseud profile pages
│   ├── bookmarks/                # Bookmarks
│   ├── collections/              # Collections
│   ├── series/                   # Series
│   ├── history/                  # Reading history
│   ├── studio/                   # Creator studio
│   └── admin/                    # Admin dashboard
├── middleware.ts                 # Auth middleware, CSRF, CSP
└── env.d.ts
```

### 5.3 API Design Principles

1. **Consistent response shape**: `{ data: T } | { error: string, details?: unknown }`
2. **HTTP methods map to intent**: GET = read, POST = create, PUT/PATCH = update, DELETE = remove
3. **Auth via middleware**: Routes declare `config.auth = 'required' | 'optional' | 'public'`. Middleware handles session parsing.
4. **Zod validation**: Every write endpoint validates input with Zod. Returns 422 with field-level errors.
5. **Pagination**: `?page=1&limit=20` → `{ data: T[], total: number, page: number, limit: number }`

### 5.4 Frontend Architecture

- **Astro pages** = server-rendered HTML shells with `<meta>` tags for SEO
- **Preact islands** = interactive widgets (editor, search, comments, kudos button)
- **Client-side navigation** = View Transitions API for smooth page-to-page transitions
- **Progressive enhancement** = Pages work without JS. Islands add interactivity.

---

## 6. Migration Strategy: v1 → v2

### 6.1 Approach: Parallel Rebuild

The v2 code lives alongside v1 in `src/v2/`. The strategy:

1. **Phase 1** (Current): Build all v2 API routes and lib layer. All new code in `src/v2/`.
2. **Phase 2**: Build v2 Astro pages + Preact islands. Pages import from `src/v2/lib/`.
3. **Phase 3**: Wire v2 pages into `src/pages/` (replacing v1 pages one by one).
4. **Phase 4**: Remove `src/lib/` (v1) and unused v1 API routes.

**Key rule**: v2 never imports from v1. Clean break.

### 6.2 Database Migration

- v2 uses the same D1 databases (dev/staging/prod) but with a fresh schema (`drizzle/v2/0000_initial.sql`).
- Migration is run per-environment: `wrangler d1 execute ffy-dev --local --file=drizzle/v2/0000_initial.sql` first, then `--env staging`, then `--env prod`.
- **Data migration from v1 schema**: NOT planned for v2.0 launch. Fresh start. v1 data is archivable but not auto-migrated.

### 6.3 What Ships First (Minimum Viable Product)

**v2.0 MVP** = auth works, you can post and read fanfiction, you can find stuff via tags/search.

1. Auth (signup, login, logout, sessions, invite codes)
2. Work CRUD (create, edit, publish)
3. Chapter CRUD (add, edit, reorder, publish)
4. Reading mode (chapter view, navigation, themes)
5. Tags (create, attach, autocomplete)
6. Search (FTS5, faceted filters)
7. Homepage (recent, popular)
8. User profile + pseuds (basic)
9. Kudos + bookmarks
10. Comments (basic threading)

**Deferred to v2.1+**: Collections, series, annotations, admin dashboard, notifications, API keys, epub export, PWA.

---

## 7. Phase Plan

### Phase 1: Foundation (Week 1-2)
- [x] 1.1 Drizzle schema (all 12 modules)
- [x] 1.2 Auth system (email/password, sessions, invite codes)
- [ ] 1.3 Auth pages (login, signup, pending-approval) — Preact + M3
- [ ] 1.4 API route validation middleware (Zod + error standardization)
- [ ] 1.5 Middleware (auth check, CSRF, CSP enforcement)

### Phase 2: Core Writing & Reading (Week 3-4)
- [ ] 2.1 Work CRUD API (create, update, delete, publish/unpublish)
- [ ] 2.2 Chapter CRUD API (create, update, reorder, delete, publish)
- [ ] 2.3 TipTap editor integration (v2 island with slash commands)
- [ ] 2.4 Reading mode page (chapter view, navigation, progress tracking)
- [ ] 2.5 Image upload pipeline (R2 upload + proxy)

### Phase 3: Discovery (Week 5-6)
- [ ] 3.1 Tag CRUD + autocomplete API
- [ ] 3.2 FTS5 search API (faceted filters, sort, pagination)
- [ ] 3.3 Homepage (recent works, popular works, random)
- [ ] 3.4 Tag landing pages (`/tags/:name`)
- [ ] 3.5 Work detail page (metadata, chapters, kudos, comments summary)

### Phase 4: Social & Profiles (Week 7-8)
- [ ] 4.1 User profile API + page
- [ ] 4.2 Pseud CRUD + public profile pages
- [ ] 4.3 Kudos API (toggle, count, per-user list)
- [ ] 4.4 Bookmarks API (create, delete, list, privacy)
- [ ] 4.5 Comments API (create, reply, delete, threading)
- [ ] 4.6 Reading history + mark-for-later API

### Phase 5: Polish & Admin (Week 9-10)
- [ ] 5.1 Admin dashboard (users, reports, invite codes, audit log)
- [ ] 5.2 Search page (Preact island with faceted filters)
- [ ] 5.3 Settings page (profile, theme, reading preferences)
- [ ] 5.4 Notifications (basic bell + dropdown)
- [ ] 5.5 M3 theme tokens + component library final pass
- [ ] 5.6 View Transitions + skeleton loading states

### Phase 6: QA & Launch (Week 11-12)
- [ ] 6.1 Test suite (auth flows, CRUD, search, pagination)
- [ ] 6.2 CI/CD pipeline (GitHub Actions: lint → test → build → deploy)
- [ ] 6.3 Staging environment validation
- [ ] 6.4 Production migration + deploy
- [ ] 6.5 v1 → v2 domain cutover

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Page load (LCP) | < 1.5s (server-rendered shells) |
| Time to interactive | < 2s (islands hydrate) |
| Search latency (FTS5) | < 100ms |
| Auth round-trip | < 200ms |
| Test coverage (critical paths) | > 80% |
| v1 feature parity (MVP scope) | 100% |
| v1 features removed (out-of-scope) | Canon, Characters, Bug Report, Lineage, Recommendations, OAuth |

---

## 9. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| D1 FTS5 limitations (no relevance scoring) | Medium | Supplement with application-level ranking. Consider Workers AI vector embeddings for v2.1. |
| Preact islands hydration order | Low | Use Astro's `client:only` for editor, `client:visible` for below-fold content. |
| Data loss on v1→v2 | High | v1 data is NOT auto-migrated. Archive v1 database before cutover. Offer manual export. |
| Scope creep (canon, characters, lineage) | Medium | Strictly defer. v2.0 = write, read, discover. v2.1 = everything else. |
| Invite code leakage | Low | Rate limit signup attempts. Require admin to generate codes. |

---

## 10. Out of Scope for v2.0

- Canon system (locations, lore, references)
- Character system (profiles, appearances, groups)
- Work lineage/relationships
- Recommendation engine
- OAuth (Google or otherwise)
- Bug report system
- PWA/offline reading
- Epub export
- API keys / public API
- Annotations (inline highlights)