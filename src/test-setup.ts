/**
 * Test setup for Preact + Vitest.
 *
 * Provides the globals and polyfills needed for testing Preact components
 * with @testing-library/preact in a happy-dom environment.
 */
import { setup } from '@testing-library/preact';

// @testing-library/preact's setup automatically configures cleanup
// after each test so you don't need afterEach(() => cleanup()).
setup();