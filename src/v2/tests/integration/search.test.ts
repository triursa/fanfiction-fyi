/**
 * Integration tests: Search & Tags API (public endpoints)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type TestServer } from './helpers';

let svc: TestServer;

describe('Search Integration', () => {
  beforeAll(async () => {
    svc = await startServer();
  }, 50_000);

  afterAll(async () => {
    await svc.stop();
  });

  describe('GET /api/search', () => {
    it('returns results for a search query', async () => {
      const res = await svc.fetch('GET', '/api/search?q=test');

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('total');
    });

    it('returns empty results for nonsensical query', async () => {
      
      const res = await svc.fetch('GET', '/api/search?q=xyznonexistent12345');

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.total).toBe(0);
    });

    it('supports pagination', async () => {
      
      const res = await svc.fetch('GET', '/api/search?q=test&page=1&limit=5');

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.page).toBe(1);
      expect(data.limit).toBeLessThanOrEqual(5);
    });

    it('rejects limit exceeding max value', async () => {
      const res = await svc.fetch('GET', '/api/search?q=test&limit=100');

      // v2 validates the limit range and rejects values over 50
      expect(res.status).toBe(422);
    });

    it('supports sort options', async () => {
      
      for (const sort of ['updated', 'published']) {
        const res = await svc.fetch('GET', '/api/search?q=test&sort=' + sort);
        expect(res.status).toBe(200);
      }
    });
  });

  describe('GET /api/tags', () => {
    it('returns a paginated list of tags', async () => {
      
      const res = await svc.fetch('GET', '/api/tags?limit=10');

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.total).toBeGreaterThan(0);
    });

    it('filters by tag type', async () => {
      
      const res = await svc.fetch('GET', '/api/tags?type=fandom');

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      const tags = data.data || [];
      if (tags.length > 0) {
        for (const tag of tags) {
          expect(tag.type).toBe('fandom');
        }
      }
    });

    it('supports search query', async () => {
      
      const res = await svc.fetch('GET', '/api/tags?q=Original');

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      const tags = data.data || [];
      expect(tags.length).toBeGreaterThan(0);
    });
  });
});