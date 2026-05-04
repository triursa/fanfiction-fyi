import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import astroPlugin from 'eslint-plugin-astro';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // Global ignores
  {
    ignores: ['dist/**', '.astro/**', '.wrangler/**', 'node_modules/**'],
  },

  // TypeScript files
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...tsPlugin.configs.stylistic.rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn', // Phase 1+ will tighten to 'error'
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/prefer-for-of': 'warn', // stylistic, not correctness
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // Astro files
  ...astroPlugin.configs['flat/recommended'],

  // React hooks rules for Preact (TSX files only)
  {
    files: ['**/*.{tsx,jsx}'],
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Prettier must be last to override other formatting rules
  prettierConfig,
];