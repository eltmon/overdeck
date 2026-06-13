import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testHome: string;
let service: { close(): void } | null = null;

beforeEach(() => {
  vi.resetModules();
  testHome = join(tmpdir(), `pan-1579-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.PANOPTICON_HOME = testHome;
  service = null;
});

afterEach(() => {
  service?.close();
  delete process.env.PANOPTICON_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('CacheService SQLite storage', () => {
  it('persists cache entries and rate limits through the SQLite adapter', async () => {
    const { CacheService } = await import('../cache-service.js');
    const cache = new CacheService();
    service = cache;

    cache.set('github', 'issues', { items: [1, 2] }, {
      etag: 'etag-1',
      lastModified: '2026-06-04T08:00:00.000Z',
      ttlSeconds: 60,
    });
    cache.updateRateLimit('github', {
      remaining: 42,
      total: 100,
      resetAt: '2026-06-04T09:00:00.000Z',
    });

    expect(cache.get('github', 'issues')?.data).toEqual({ items: [1, 2] });
    expect(cache.getEtag('github', 'issues')).toBe('etag-1');
    expect(cache.getRateLimit('github')).toEqual({
      remaining: 42,
      total: 100,
      resetAt: '2026-06-04T09:00:00.000Z',
    });
  });
});
