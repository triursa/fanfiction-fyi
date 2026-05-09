# fanfiction.fyi — End-to-End Completion Plan

Created: 2026-05-09

## Current State

| Item | Status |
|------|--------|
| Main branch | Clean, up to date |
| Open PRs | **#103** — Copilot review fixes for Phase 4 (unmerged) |
| Open Issues | **#103** (PR), **#25** (Smart Next Read — deferred), **#23** (Inline Annotations — deferred), **#22** (Work Skins — deferred) |
| Phases 1-4 | All closed and merged |
| Debug endpoint | `/api/auth/google/debug` still deployed (temporary) |

---

## Step 1: Merge PR #103

- 3 targeted fixes: unused import removal, snake_case→camelCase bug in API keys UI, `finally` block for button re-enable
- Merge via GitHub, pull main locally
- Time: ~2 min

## Step 2: Remove debug endpoint & close Phase 4 loose ends

- Delete `/api/auth/google/debug` endpoint (temporary per pitfalls)
- Verify all Phase 4 features work post-merge
- Branch: `fix/remove-debug-endpoint`
- Time: ~15 min

## Step 3: Work Skins / Theming (#22)

### 3a — Schema migration
- Add `work_skin TEXT DEFAULT 'default'` to `works` table
- Create `drizzle/0004_work_skins.sql`
- Apply to remote D1
- Update `src/lib/schema/works.ts`

### 3b — Skin CSS
- 5 skin classes in `theme.css`: `.skin-default`, `.skin-typewriter`, `.skin-manuscript`, `.skin-terminal`, `.skin-parchment`
- Each: font-family, line-height, max-width, background, text color, link color
- WCAG AA contrast required

### 3c — Work editor skin picker
- `<select>` dropdown for `work_skin` in draft editor
- Post/PUT via works API

### 3d — Reading page applies skin
- `read.astro` reads `work.skin` from API response
- Wraps `.prose-content` with `.skin-{value}` class
- Fallback to `.skin-default`

### 3e — Reader override in settings
- "Reading Skin" preference in `/settings`
- Extend `GET/PUT /api/user/profile` with `reading_skin_override`
- Reading page: user override > author skin > default

### 3f — Build, test, PR, deploy
- `npm run build` clean
- Visual QA each skin
- PR + Copilot review + merge

Time: ~3-4 hrs

## Step 4: Inline Reader Annotations (#23)

### 4a — Schema migration
- `annotations` table: `id, chapter_id, user_id, start_offset, end_offset, note_text, color TEXT DEFAULT 'yellow', shared_with_author BOOLEAN DEFAULT FALSE, created_at, updated_at`
- `drizzle/0005_annotations.sql`
- New `src/lib/schema/annotations.ts` + barrel export
- Index on `(chapter_id, user_id)`

### 4b — API endpoints
- `GET /api/works/:workId/chapters/:chapterId/annotations`
- `POST /api/works/:workId/chapters/:chapterId/annotations`
- `PUT /api/works/:workId/chapters/:chapterId/annotations/:id`
- `DELETE /api/works/:workId/chapters/:chapterId/annotations/:id`
- `PATCH toggle shared_with_author`

### 4c — Preact annotation component
- `AnnotationsLayer.tsx`
- Text selection → floating tooltip → "Annotate"
- Highlight overlay at offsets
- Color picker
- Toggle visibility

### 4d — Mobile annotation
- Long-press → same create flow
- Tap highlight to show note

### 4e — Author notification (optional)
- `shared_with_author = true` → `createNotification()`

### 4f — Build, test, PR, deploy

Time: ~5-6 hrs

## Step 5: Smart Next Read Recommendations (#25)

### 5a — Schema
- `work_recommendations` table: `id, work_id, recommended_work_id, score REAL, reason TEXT, updated_at`
- `drizzle/0006_recommendations.sql`

### 5b — Recommendation engine (SQL)
- Kudos-overlap query
- Tag-based fallback for works with <5 kudos
- Store in `work_recommendations`, update via cron or on-demand

### 5c — "You might also like" section
- `Recommendations.tsx` on work detail page
- 3-5 recommended works

### 5d — Build, test, PR, deploy

Time: ~3-4 hrs

---

## Execution Order & Dependencies

```
1. Merge PR #103              → immediate, 2 min
2. Remove debug endpoint      → after #1, 15 min
3. Work Skins (#22)           → after #2, 3-4 hrs
4. Annotations (#23)          → after #3, 5-6 hrs
5. Recommendations (#25)      → after #4, 3-4 hrs
```

Total estimated time: ~12-14 hours of focused work.