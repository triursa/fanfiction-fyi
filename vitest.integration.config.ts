import { defineConfig } from 'vitest/config';

/**
 * Integration test config for fanfiction.fyi v2.
 *
 * Each test file starts its own dev server on a unique port.
 *
 * Prerequisites:
 *   npm run db:v2:migrate:dev   (run once)
 *   npm run db:v2:seed:dev      (run once)
 *
 * Run with:   npm run test:integration
 * Debug:      DEBUG_INTEGRATION=1 npm run test:integration
 */
export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    include: ['src/v2/tests/integration/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 55_000,
    // Serial execution — servers need time to start/stop
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});