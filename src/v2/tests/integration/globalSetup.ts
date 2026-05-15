/**
 * Global setup for integration tests.
 * Starts the Astro dev server once before all tests.
 */

import { startServer, type TestServer } from './helpers';

let server: TestServer | null = null;

export async function setup() {
  server = await startServer(4321);
  (globalThis as any).__FFY_TEST_SERVER__ = server;
}

export async function teardown() {
  if (server) {
    await server.stop();
    server = null;
  }
  delete (globalThis as any).__FFY_TEST_SERVER__;
}

export function getServer(): TestServer {
  const srv = (globalThis as any).__FFY_TEST_SERVER__ as TestServer | undefined;
  if (!srv) throw new Error('Test server not initialized — did globalSetup run?');
  return srv;
}
