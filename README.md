# fanfiction.fyi

Bespoke small-scale fanfiction archive — AO3-inspired, Material Design 3, Cloudflare Pages + D1.

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Astro + Preact (islands) |
| UI | Material Web (M3 components) |
| Editor | TipTap (ProseMirror) |
| Backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Storage | Google Cloud Storage (storage.kaleb.one) |
| Auth | Invite-code signup, session cookies |
| Search | D1 FTS5 |

## Setup

```bash
npm install
npm run dev          # local dev server
npm run db:migrate   # apply D1 schema locally
npm run build        # production build
```

## Phases

- **Phase 0** — Scaffolding, schema, M3 theme ✅
- **Phase 1** — Auth, drafting, work display
- **Phase 2** — Tags, collections, search
- **Phase 3** — Comments, mod tools, reading history
- **Phase 4** — RSS, notifications, API

## Design System

- **Standard:** Material Design 3
- **Palette:** Obsidian (seed `#7B8FA8`)
- **Typography:** Inter (sans) + JetBrains Mono (code)
- **Theme tokens:** `src/styles/theme.css`

## License

Private — not part of the kaleb.one stack.