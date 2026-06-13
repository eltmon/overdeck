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

describe('CacheService poll health (PAN-1817)', () => {
  it('returns null for a tracker with no recorded poll outcome', async () => {
    const { CacheService } = await import('../cache-service.js');
    const cache = new CacheService();
    service = cache;

    expect(cache.getPollHealth('linear')).toBeNull();
  });

  it('persists and returns poll health status and message', async () => {
    const { CacheService } = await import('../cache-service.js');
    const cache = new CacheService();
    service = cache;

    cache.recordPollHealth('linear', { status: 'quota_exhausted', message: 'rate limit hit' });

    const health = cache.getPollHealth('linear');
    expect(health?.status).toBe('quota_exhausted');
    expect(health?.message).toBe('rate limit hit');
    expect(health?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('upserts the latest poll health for the same tracker', async () => {
    const { CacheService } = await import('../cache-service.js');
    const cache = new CacheService();
    service = cache;

    cache.recordPollHealth('github', { status: 'error', message: 'timeout' });
    cache.recordPollHealth('github', { status: 'ok', message: 'ok' });

    const health = cache.getPollHealth('github');
    expect(health?.status).toBe('ok');
    expect(health?.message).toBe('ok');
  });

  it('keeps records isolated per tracker', async () => {
    const { CacheService } = await import('../cache-service.js');
    const cache = new CacheService();
    service = cache;

    cache.recordPollHealth('linear', { status: 'quota_exhausted', message: 'linear rate limited' });
    cache.recordPollHealth('github', { status: 'ok', message: 'ok' });

    expect(cache.getPollHealth('linear')?.status).toBe('quota_exhausted');
    expect(cache.getPollHealth('github')?.status).toBe('ok');
    expect(cache.getPollHealth('rally')).toBeNull();
  });
});
