# fanfiction.fyi — Quality of Life Roadmap

> Phased approach based on architecture audit (May 2026). Each phase is deliverable in isolation. Phases unlock progressively — later phases assume earlier ones are in place.

---

## Phase 0: Hygiene & Dead Weight
**Goal:** Remove friction, eliminate tech debt that will block later phases.
**Effort:** ~1 day

| # | Item | Why |
|---|------|-----|
| 0.1 | Remove `tiptap` v1 package | Dead dependency — `package.json` has both v1 (`tiptap: ^1.0.0`) and v2 (`@tiptap/*`). Only v2 is imported. Run `npm uninstall tiptap`. |
| 0.2 | Add `.env.example` | Document required env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.). No secrets, just keys. |
| 0.3 | Add ESLint + Prettier | Zero linting or formatting config exists. Add `eslint`, `@typescript-eslint/*`, `prettier`, `eslint-config-prettier`. One `npm run lint` script. |
| 0.4 | Extract Editor globals → Preact signals | `(window as any).__editorMarkdown` etc. are fragile. Replace with `@preact/signals` — 3 signals: `editorMarkdown`, `editorContent`, `editorImageKeys`. |

**Verification:** `npm run lint` passes clean. Editor still round-trips markdown. Dead package gone.

---

## Phase 1: Drizzle ORM + Type Safety ✅ COMPLETE
**Goal:** Replace raw SQL strings with type-safe queries. Single source of truth for schema.
**Effort:** ~3-4 days → Completed

|| # | Item | Status ||
||---|------|-------||
|| 1.1 | Install Drizzle | ✅ Done |
|| 1.2 | Define schema in `src/lib/schema/` | ✅ Done — users, works, tags, chapters, comments, collections, series, kudos, bookmarks, pseuds, canon, characters, publish-log |
|| 1.3 | Replace `src/lib/db.ts` | ✅ Done — `getDrizzle()` + `getDb()` helpers. Legacy `queryFirst`/`queryAll`/`run` removed |
|| 1.4 | Convert call sites | ✅ Done — 70+ files converted to Drizzle ORM |
|| 1.5 | Generate TypeScript types | ✅ Done — `drizzle-kit generate` outputs migration, types derive from schema |
|| 1.6 | Migration tooling | ✅ Done — `drizzle-kit generate` + `drizzle.config.ts` |
|| 1.7 | Delete manual interfaces from `types.ts` | ✅ Done — only UserRole, role utilities, and type aliases remain |

**Verification:** All existing API routes return identical results. `npm run db:push` works against local D1. Types compile clean.

---

## Phase 2: Editor QOL (TipTap)
**Goal:** Make the drafting experience premium — this is the core product differentiator.
**Effort:** ~2-3 days

| # | Item | Why |
|---|------|-----|
| 2.1 | Slash commands menu | Install `@tiptap/slash-commands` (or `tiptap-markdown` + custom extension). Keyboard-driven formatting — `/h1`, `/bold`, `/italic`, `/quote`, `/code`, `/image`. Matches the "hands stay on keyboard" writer flow. |
| 2.2 | Autosave to localStorage | On every TipTap `onUpdate`, debounce 2s, write `editorMarkdown` + `currentChapterId` to `localStorage`. On mount, check localStorage before fetching from D1. Add "Restore draft?" banner if stale content found. Clear localStorage on successful server save. |
| 2.3 | Word count + reading time bubble | `@tiptap/character-count` is already installed. Wire `editor.storage.characterCount.words` → floating indicator. Reading time = `words ÷ 200`. Display in editor footer bar. |
| 2.4 | Keyboard shortcuts cheat sheet | `?` key toggles a floating shortcut modal (Ctrl+B, Ctrl+I, Ctrl+K, etc.). Standard AO3/Google Docs pattern. |
| 2.5 | Improved image upload feedback | R2 uploads already work, but add: drag-over highlight state, upload progress bar, inline thumbnail preview before save. |

**Verification:** Type `/bold` → text boldens. Close tab mid-edit → reopen → draft restored. Word count updates live. Shortcuts modal appears on `?`.

---

## Phase 3: UI/UX Refinement (M3 + Astro)
**Goal:** Polish the visual layer — discovery, transitions, and loading states.
**Effort:** ~2-3 days

| # | Item | Why |
|---|------|-----|
| 3.1 | View Transitions + theme persistence | Astro supports `transition:animate="fade"` natively. Enable View Transitions in `astro.config.mjs`. Theme already switches via localStorage — verify no FOUC during transitions. If flash occurs, add `is:inline` script in `<head>` to set theme before paint. |
| 3.2 | Skeleton loading states | Add M3 Skeleton (`<md-skeleton>)` or CSS skeleton classes) to: WorkCard, TagCluster, CommentThread, CreatorStudio. Preact islands should render skeletons during hydration. Use `Suspense` boundaries or `useEffect` + loading state pattern. |
| 3.3 | Masonry grid for discovery/search | Switch WorkCard grid from `display: grid` with fixed rows to a CSS `columns` or Masonry JS layout. Different summary lengths + tag counts cause awkward whitespace in a strict grid. |
| 3.4 | 404 + 500 error pages | Create `src/pages/404.astro` and `src/pages/500.astro`. Styled with M3 tokens. 404 gets a "back to home" link. 500 gets a "report bug" link (BugReport already exists). |
| 3.5 | CSP: report-only → enforcement | After QOL work stabilizes, flip `reportOnly: true` → `reportOnly: false` in `csp.ts`. Monitor violations in production for a week before removing report-uri endpoint. |

**Verification:** Navigation between pages has smooth transitions (no full-page flash). Skeleton states visible on slow connections. 404 renders correctly. No CSP violations in console.

---

## Phase 4: Cloudflare Performance
**Goal:** Reduce latency for all users, optimize asset delivery.
**Effort:** ~1-2 days

| # | Item | Why |
|---|------|-----|
| 4.1 | Enable `smart_placement = true` | Add to `wrangler.toml`. Moves Workers compute closer to D1 — reduces cold-start latency regardless of user location. Zero code change. |
| 4.2 | Image optimization proxy | Add a `/api/image/[key]` route that fetches from R2 and returns `webp`/`avif` via sharp or a simple header-based negotiate. Alternatively, use Cloudflare Images if budget permits. For now: R2 proxy + `Accept` header content negotiation + `Cache-Control: public, max-age=31536000`. |
| 4.3 | FTS5 stemmer | In the next D1 migration, rebuild `works_fts` with `tokenizer="porter unicode61"`. The Porter stemmer matches "Running" ↔ "Run", "Wolves" ↔ "Wolf" — critical for a text archive. |
| 4.4 | Cache headers for static assets | Astro's Cloudflare adapter should handle this, but verify `_headers` file in `public/` sets long cache for `/_astro/*` assets. Add `Cache-Control: public, max-age=31536000, immutable`. |

**Verification:** `smart_placement` visible in Wrangler deploy output. Image responses include `Content-Type: image/webp` where browser supports it. FTS5 search for "running" returns works containing "run".

---

## Phase 5: Test Infrastructure & CI
**Goal:** Protect against regressions. Enable confident refactoring.
**Effort:** ~2-3 days

| # | Item | Why |
|---|------|-----|
| 5.1 | Install Vitest | `npm i -D vitest @vitest/coverage-v8`. Config extends from Vite (Astro integration). |
| 5.2 | Test Drizzle schema | Unit tests confirming schema definitions match expected table/column names. Quick to write, catches typos. |
| 5.3 | Test auth flow | Integration tests: signup, login, session creation, OAuth callback. Use `unstable_dev()` from `wrangler` for D1 bindings. |
| 5.4 | Test API routes | Hit each `/api/*` route with `app.render()` (Astro testing utilities). Verify JSON shape, error handling. |
| 5.5 | GitHub Actions workflow | `.github/workflows/ci.yml`: `npm ci` → `npm run lint` → `npm run test` → `npm run build`. Run on PR. Block merge on failure. |
| 5.6 | Type-check in CI | Add `npm run astro check` to CI pipeline. Catches Drizzle type mismatches before deploy. |

**Verification:** `npm run test` passes. CI runs green on a test PR. Coverage report generated.

---

## Phase 6: Future-Proofing
**Goal:** Patterns and infrastructure for scale.
**Effort:** ~2-3 days (can be deferred)

| # | Item | Why |
|---|------|-----|
| 6.1 | Rate limiting middleware | Schema migration 008 exists but isn't wired into routes. Add middleware that checks `rate_limits` table before processing writes. |
| 6.2 | Audit logging | Log admin actions (user role changes, content moderation) to a `audit_log` D1 table. Enables accountability. |
| 6.3 | Webhook for content events | Optional: notify Discord webhook on new work published, new user signup. Light observer pattern. |
| 6.4 | Drizzle Studio | `npm run db:studio` opens local Drizzle Studio against D1 for visual inspection. Useful for debugging without Wrangler SQL console. |
| 6.5 | E2E tests (Playwright) | High-effort, high-value. Test the actual writer flow: login → create work → add chapter → publish → verify on browse page. |

---

## What's Already Done (No Action Needed)

✅ M3 theme system (6 themes, dynamic switching, localStorage persistence)
✅ TipTap v2 editor with markdown round-trip, image upload, drag-and-drop
✅ M3 design tokens (colors, typography, shape, motion, elevation)
✅ Auth system (PBKDF2 + session cookies + Google OAuth + invite codes)
✅ CSP headers (report-only mode)
✅ CORS + CSRF protection
✅ R2 image upload pipeline
✅ Markdown pipeline (marked + sanitize-html + turndown)
✅ Epub export
✅ RSS feed
✅ Responsive/adaptive navigation
✅ Reading mode
✅ Character count extension (installed, needs wiring — addressed in Phase 2.3)

---

## Dependency Graph

```
Phase 0 (Hygiene) ──────────────────────────────────────────┐
Phase 1 (Drizzle) ─── depends on Phase 0.4 (signals) ───────┤
Phase 2 (Editor QOL) ─── independent, can parallel 1 ───────┤
Phase 3 (UI/UX) ─── independent, can parallel 1-2 ─────────┤
Phase 4 (Performance) ─── depends on Phase 1 (schema) ──────┤
Phase 5 (Tests + CI) ─── depends on Phase 1 (types) ────────┤
Phase 6 (Future-proof) ─── depends on Phase 1 + 5 ──────────┘
```

**Parallel tracks:** Phase 0 → Phase 1 (critical path). Phase 2 + Phase 3 can run concurrently with Phase 1 since they don't touch DB code. Phase 4-6 are sequential after Phase 1.

**Total estimate:** ~12-16 days of focused work.