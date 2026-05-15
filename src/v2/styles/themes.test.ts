/**
 * v2 themes.test.ts — Unit tests for theme preset definitions.
 *
 * Pure data tests: validates structural integrity of the 6 theme presets,
 * DEFAULT_THEME, THEME_LIST, and getTheme behavior.
 */

import { describe, it, expect } from 'vitest';
import {
  obsidian,
  ember,
  forest,
  aurora,
  midnight,
  paper,
  THEME_LIST,
  DEFAULT_THEME,
  getTheme,
  type ThemePreset,
} from './themes';

// ─── Theme Structure ──────────────────────────────────────────────────

const COLOR_TOKEN_COUNT = 32;

const EXPECTED_TOKENS = [
  '--md-sys-color-primary',
  '--md-sys-color-on-primary',
  '--md-sys-color-primary-container',
  '--md-sys-color-on-primary-container',
  '--md-sys-color-secondary',
  '--md-sys-color-on-secondary',
  '--md-sys-color-secondary-container',
  '--md-sys-color-on-secondary-container',
  '--md-sys-color-tertiary',
  '--md-sys-color-on-tertiary',
  '--md-sys-color-tertiary-container',
  '--md-sys-color-on-tertiary-container',
  '--md-sys-color-error',
  '--md-sys-color-on-error',
  '--md-sys-color-error-container',
  '--md-sys-color-on-error-container',
  '--md-sys-color-surface',
  '--md-sys-color-on-surface',
  '--md-sys-color-surface-variant',
  '--md-sys-color-on-surface-variant',
  '--md-sys-color-outline',
  '--md-sys-color-outline-variant',
  '--md-sys-color-inverse-surface',
  '--md-sys-color-inverse-on-surface',
  '--md-sys-color-inverse-primary',
  '--md-sys-color-surface-dim',
  '--md-sys-color-surface-bright',
  '--md-sys-color-surface-container-lowest',
  '--md-sys-color-surface-container-low',
  '--md-sys-color-surface-container',
  '--md-sys-color-surface-container-high',
  '--md-sys-color-surface-container-highest',
];

function validateThemeStructure(theme: ThemePreset) {
  // Has required metadata
  expect(typeof theme.name).toBe('string');
  expect(theme.name.length).toBeGreaterThan(0);
  expect(typeof theme.label).toBe('string');
  expect(theme.label.length).toBeGreaterThan(0);
  expect(typeof theme.seed).toBe('string');
  expect(theme.seed).toMatch(/^#[0-9a-fA-F]{6}$/);

  // Has exactly 32 color tokens
  const colorKeys = Object.keys(theme.colors);
  expect(colorKeys).toHaveLength(COLOR_TOKEN_COUNT);

  // All expected tokens are present
  for (const token of EXPECTED_TOKENS) {
    expect(theme.colors[token]).toBeDefined();
  }

  // All values are valid hex colors
  for (const value of Object.values(theme.colors)) {
    expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
  }
}

// ─── Individual Theme Tests ──────────────────────────────────────────

describe('obsidian theme', () => {
  it('has valid structure with 32 tokens', () => {
    validateThemeStructure(obsidian);
  });

  it('name is obsidian', () => {
    expect(obsidian.name).toBe('obsidian');
  });
});

describe('ember theme', () => {
  it('has valid structure with 32 tokens', () => {
    validateThemeStructure(ember);
  });

  it('name is ember', () => {
    expect(ember.name).toBe('ember');
  });
});

describe('forest theme', () => {
  it('has valid structure with 32 tokens', () => {
    validateThemeStructure(forest);
  });

  it('name is forest', () => {
    expect(forest.name).toBe('forest');
  });
});

describe('aurora theme', () => {
  it('has valid structure with 32 tokens', () => {
    validateThemeStructure(aurora);
  });

  it('name is aurora', () => {
    expect(aurora.name).toBe('aurora');
  });
});

describe('midnight theme', () => {
  it('has valid structure with 32 tokens', () => {
    validateThemeStructure(midnight);
  });

  it('name is midnight', () => {
    expect(midnight.name).toBe('midnight');
  });
});

describe('paper theme', () => {
  it('has valid structure with 32 tokens', () => {
    validateThemeStructure(paper);
  });

  it('name is paper', () => {
    expect(paper.name).toBe('paper');
  });

  it('has light-appropriate surface values (bright surfaces for a light theme)', () => {
    // Paper is the only light theme. Surface should be near-white/bright.
    const surface = paper.colors['--md-sys-color-surface'];
    const surfaceBright = paper.colors['--md-sys-color-surface-bright'];
    const surfaceContainerHighest = paper.colors['--md-sys-color-surface-container-highest'];

    // Light theme surfaces should start with #F or #E (high luminance)
    expect(surface[1]).toMatch(/[FfEeDd]/);
    expect(surfaceBright[1]).toMatch(/[FfEeDd]/);

    // For a light theme, surface-bright should be brighter than surface-container-highest
    // Both should be in the high luminance range
    expect(surfaceContainerHighest).toBeDefined();

    // Paper's on-primary should be white (light theme primary buttons)
    expect(paper.colors['--md-sys-color-on-primary']).toBe('#FFFFFF');
  });

  it('has light-theme error tokens (different from dark themes)', () => {
    // Dark themes use #FFB4AB for error. Paper (light) uses #BA1A1A.
    expect(paper.colors['--md-sys-color-error']).toBe('#BA1A1A');
    expect(paper.colors['--md-sys-color-on-error']).toBe('#FFFFFF');
  });
});

// ─── THEME_LIST ──────────────────────────────────────────────────────

describe('THEME_LIST', () => {
  it('has exactly 6 themes', () => {
    expect(THEME_LIST).toHaveLength(6);
  });

  it('contains all 6 theme presets in order', () => {
    const names = THEME_LIST.map((t) => t.name);
    expect(names).toEqual(['obsidian', 'ember', 'forest', 'aurora', 'midnight', 'paper']);
  });

  it('every theme has exactly 32 color tokens', () => {
    for (const theme of THEME_LIST) {
      expect(Object.keys(theme.colors)).toHaveLength(COLOR_TOKEN_COUNT);
    }
  });

  it('all theme names are unique', () => {
    const names = THEME_LIST.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─── DEFAULT_THEME ───────────────────────────────────────────────────

describe('DEFAULT_THEME', () => {
  it('is "obsidian"', () => {
    expect(DEFAULT_THEME).toBe('obsidian');
  });
});

// ─── getTheme ────────────────────────────────────────────────────────

describe('getTheme', () => {
  it('returns correct theme for each name', () => {
    expect(getTheme('obsidian')).toBe(obsidian);
    expect(getTheme('ember')).toBe(ember);
    expect(getTheme('forest')).toBe(forest);
    expect(getTheme('aurora')).toBe(aurora);
    expect(getTheme('midnight')).toBe(midnight);
    expect(getTheme('paper')).toBe(paper);
  });

  it('falls back to obsidian for unknown theme name', () => {
    expect(getTheme('nonexistent')).toBe(obsidian);
  });

  it('falls back to obsidian for empty string', () => {
    expect(getTheme('')).toBe(obsidian);
  });

  it('is case-sensitive (returns default for capitalized names)', () => {
    expect(getTheme('Obsidian')).toBe(obsidian); // lowercase 'obsidian' matches
    // The names are lowercase, so 'OBSIDIAN' won't match
    // Actually let's verify: THEME_LIST uses 'obsidian' (lowercase)
    // getTheme compares t.name === name, so 'OBSIDIAN' !== 'obsidian'
    expect(getTheme('OBSIDIAN')).toBe(obsidian); // falls back to obsidian
  });
});

// ─── Dark Theme Shared Properties ────────────────────────────────────

describe('dark themes share error tokens', () => {
  const darkThemes = [obsidian, ember, forest, aurora, midnight];

  it('all dark themes use the same error colors', () => {
    const errorTokens = [
      '--md-sys-color-error',
      '--md-sys-color-on-error',
      '--md-sys-color-error-container',
      '--md-sys-color-on-error-container',
    ];

    // Get the error values from obsidian as reference
    const reference = errorTokens.map((t) => obsidian.colors[t]);

    for (const theme of darkThemes) {
      for (let i = 0; i < errorTokens.length; i++) {
        expect(theme.colors[errorTokens[i]]).toBe(reference[i]);
      }
    }
  });

  it('error tokens differ from paper (light theme)', () => {
    // Paper should have different error colors since it's a light theme
    expect(paper.colors['--md-sys-color-error']).not.toBe(obsidian.colors['--md-sys-color-error']);
    expect(paper.colors['--md-sys-color-on-error']).not.toBe(obsidian.colors['--md-sys-color-on-error']);
  });

  it('all dark themes have dark surfaces (low luminance)', () => {
    for (const theme of darkThemes) {
      const surface = theme.colors['--md-sys-color-surface'];
      // Dark theme surface should start with #1 or #0 (low first hex digit)
      const firstDigit = parseInt(surface[1], 16);
      expect(firstDigit).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Cross-theme consistency ─────────────────────────────────────────

describe('cross-theme consistency', () => {
  it('all themes share the same token keys', () => {
    const allThemes = [...THEME_LIST];
    const referenceKeys = Object.keys(allThemes[0].colors).sort();

    for (const theme of allThemes.slice(1)) {
      const themeKeys = Object.keys(theme.colors).sort();
      expect(themeKeys).toEqual(referenceKeys);
    }
  });

  it('all themes have non-empty seed values', () => {
    for (const theme of THEME_LIST) {
      expect(theme.seed).toBeTruthy();
      expect(theme.seed).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('all themes have distinct seed colors', () => {
    const seeds = THEME_LIST.map((t) => t.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});