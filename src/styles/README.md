# fanfiction.fyi v2 — CSS Architecture

This directory contains the CSS architecture for **fanfiction.fyi v2**, built on **CSS Modules** and **Material Design 3 tokens**.

## File Structure

```
src/styles/
├── tokens.css              ← M3 design tokens (colors, spacing, typography, etc.)
├── global.css              ← Minimal global reset + base styles (imports tokens.css)
├── theme.css               ← LEGACY — full monolithic theme (still in use, do NOT delete)
├── adaptive-nav.css        ← Navigation styles (will migrate to module later)
├── tiptap.css              ← Rich text editor styles
├── portfolio.css           ← Pseud portfolio styles
├── composer.css             ← Work creation/composition styles
├── example.module.css      ← Reference pattern for CSS Module usage
└── README.md               ← This file
```

## How CSS Modules Work in Astro

Astro 5 supports CSS Modules natively. Any file ending in `.module.css` is treated as a CSS Module.

### Basic Usage

```astro
---
// Component.astro
import styles from './Component.module.css'
---

<div class={styles.container}>
  <h1 class={styles.heading}>Hello</h1>
  <p class={styles.body}>World</p>
</div>
```

Or in Preact/React:

```tsx
import styles from './Component.module.css'

export function Component() {
  return (
    <div class={styles.container}>
      <h1 class={styles.heading}>Hello</h1>
    </div>
  )
}
```

Astro hashes all class names in `.module.css` files, so `.container` becomes `._container_1a2b3`. This provides automatic scoping — no BEM, no naming conflicts, no specificity wars.

### In `.astro` Files with `<style>`

You can also use scoped styles directly in `.astro` files:

```astro
<style>
  /* These styles are scoped to this component only */
  .heading { font: var(--md-sys-typescale-title-large); }
</style>
```

Use `<style is:global>` only when you genuinely need global styles (like reset, tokens, or dynamic attribute selectors). The v2 architecture minimizes `is:global` usage.

## M3 Token Naming Conventions

All design tokens follow the Material Design 3 naming scheme:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `--md-sys-color-*` | Color roles | `var(--md-sys-color-primary)` |
| `--md-sys-typescale-*` | Typography presets | `var(--md-sys-typescale-body-large)` |
| `--md-sys-elevation-*` | Box shadow levels | `var(--md-sys-elevation-2)` |
| `--md-sys-shape-corner-*` | Border radius | `var(--md-sys-shape-corner-medium)` |
| `--md-sys-motion-*` | Easing & duration | `var(--md-sys-motion-duration-short4)` |
| `--space-*` | 4px grid spacing | `var(--space-4)` |
| `--breakpoint-*` | Responsive breakpoints | `var(--breakpoint-tablet)` |

Tokens are defined in `tokens.css` and imported via `global.css`. They're global custom properties — available everywhere, but only the **values** are global. Component **styles** should be scoped via CSS Modules.

## Theme Switching

The app supports multiple M3 color themes (obsidian, ember, forest, aurora, midnight, paper). Theme switching works by overriding the `--md-sys-color-*` tokens at `:root` level via JavaScript:

1. `themes.ts` defines all theme color maps
2. `Base.astro` applies the user's theme by setting custom properties on `:root`
3. A client-side script checks `localStorage` for theme preference on load

Because all component styles reference `var(--md-sys-color-primary)` (etc.), themes cascade automatically. No component needs to know about theming.

## Work Skin System

Work skins override typography and reading-area colors for the prose content area. They are applied via `data-skin` attribute on `.reading-container`:

```html
<div class="reading-container" data-skin="typewriter">
  <!-- Prose content with Courier monospace */
</div>
```

### Available Skins

| Skin | Description |
|------|-------------|
| `default` (no attribute) | Inherits :root tokens — Inter for UI, Lora for headings |
| `typewriter` | Monospaced Courier, stark, typewritten feel |
| `manuscript` | Lora serif throughout, light parchment background |
| `terminal` | Green-on-black hacker aesthetic, JetBrains Mono |
| `parchment` | Warm cream background, soft sepia, Lora serif |

Skin overrides are defined in `tokens.css` using `.reading-container[data-skin="..."]` selectors. They override typography tokens and set `--reading-font`, `--reading-bg`, and `--reading-fg` custom properties that the prose rendering layer uses.

## Migration Path from theme.css

The existing `theme.css` (899 lines) contains everything in one file: tokens, resets, component styles, layout styles, skeleton styles, annotation styles, etc. This is being incrementally migrated:

### Phase 1 — Architecture Setup ✅ (This PR)
- [x] Extract tokens into `tokens.css`
- [x] Create slim `global.css` with reset + base styles
- [x] Create `example.module.css` as a reference
- [x] Document the architecture

### Phase 2 — Component Migration (Iterative)
- Each component gets its own `.module.css` file
- Move styles from `theme.css` or inline `<style is:global>` into the module
- Replace class name references in templates
- Example: `WorkCard.module.css`, `TagCluster.module.css`

### Phase 3 — Cleanup
- Remove `theme.css` once all component styles have migrated
- Remove `is:global` from `Base.astro` style block (replace with module imports)
- Audit for unused global classes

### Migration Rules

1. **Never delete from theme.css until the consuming component has been migrated.** The old styles must continue to work.
2. **Migrate one component at a time**, test thoroughly, then move on.
3. **Keep tokens global.** Never put token definitions in module files.
4. **Work skins stay global** because they use attribute selectors on `.reading-container`.
5. **Utility classes like `.sr-only` stay in global.css** — they're used everywhere.

## Adding a New Component

```bash
# 1. Create the module file
touch src/components/MyComponent/MyComponent.module.css

# 2. Write component-scoped styles using tokens
# MyComponent.module.css
.container {
  background: var(--md-sys-color-surface-container);
  padding: var(--space-4);
  border-radius: var(--md-sys-shape-corner-medium);
}

# 3. Import and use in your component
# MyComponent.astro
# import styles from './MyComponent.module.css'
# <div class={styles.container}>...</div>
```

## Breakpoints

The project uses three breakpoints matching M3 guidelines:

| Name | Range | CSS |
|------|-------|-----|
| Mobile | 0–599px | `@media (max-width: 599px)` |
| Tablet | 600–839px | `@media (min-width: 600px) and (max-width: 839px)` |
| Desktop | 840px+ | `@media (min-width: 840px)` |

Note: CSS custom properties cannot be used inside `@media` queries, so breakpoints must use raw pixel values. The `--breakpoint-*` tokens in `tokens.css` exist for JavaScript reference only.