/**
 * Test setup for Preact + Vitest.
 *
 * Provides the globals and polyfills needed for testing Preact components
 * with @testing-library/preact in a happy-dom environment.
 * Silently skips if @testing-library/preact is not available (v2 pure-TS tests).
 */

let setup: (() => void) | undefined;
try {
  const mod = await import('@testing-library/preact');
  setup = mod.setup;
} catch {
  // @testing-library/preact not available — skip Preact setup
}

if (setup) {
  setup();
}