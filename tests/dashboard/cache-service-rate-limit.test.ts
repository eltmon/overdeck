import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CacheService } from '../../src/dashboard/server/services/cache-service.js';

describe('CacheService - getSuspensionMs', () => {
  let testDir: string;
  let panopticonHome: string;
  let cache: CacheService;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'cache-suspension-test-'));
    panopticonHome = join(testDir, '.panopticon');
    mkdirSync(panopticonHome, { recursive: true });
    vi.stubEnv('OVERDECK_HOME', panopticonHome);
    vi.resetModules();
    const { CacheService } = await import('../../src/dashboard/server/services/cache-service.js');
    cache = new CacheService();
  });

  afterEach(() => {
    cache.close();
    vi.unstubAllEnvs();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns 0 when no rate limit row exists', () => {
    expect(cache.getSuspensionMs('linear', Date.now())).toBe(0);
  });

  it('returns 0 when remaining is positive', () => {
    cache.updateRateLimit('linear', {
      remaining: 100,
      total: 2500,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(cache.getSuspensionMs('linear', Date.now())).toBe(0);
  });

  it('returns suspension ms when remaining is 0 and resetAt is in the future', () => {
    const now = Date.now();
    const resetAt = new Date(now + 3_600_000).toISOString();
    cache.updateRateLimit('linear', { remaining: 0, total: 2500, resetAt });

    const result = cache.getSuspensionMs('linear', now);

    expect(result).toBeGreaterThan(3_590_000);
    expect(result).toBeLessThanOrEqual(3_600_000);
  });

  it('returns 0 when remaining is 0 but resetAt is in the past', () => {
    const now = Date.now();
    cache.updateRateLimit('linear', {
      remaining: 0,
      total: 2500,
      resetAt: new Date(now - 1000).toISOString(),
    });

    expect(cache.getSuspensionMs('linear', now)).toBe(0);
  });

  it('returns 0 when resetAt is unparseable', () => {
    cache.updateRateLimit('linear', {
      remaining: 0,
      total: 2500,
      resetAt: 'not-a-date',
    });

    expect(cache.getSuspensionMs('linear', Date.now())).toBe(0);
  });

  it('returns 0 when remaining is negative (treat as exhausted-but-no-suspension if reset passed)', () => {
    const now = Date.now();
    cache.updateRateLimit('linear', {
      remaining: -1,
      total: 2500,
      resetAt: new Date(now - 1000).toISOString(),
    });

    expect(cache.getSuspensionMs('linear', now)).toBe(0);
  });

  it('suspends when remaining is negative and resetAt is in the future', () => {
    const now = Date.now();
    const resetAt = new Date(now + 120_000).toISOString();
    cache.updateRateLimit('linear', { remaining: -1, total: 2500, resetAt });

    expect(cache.getSuspensionMs('linear', now)).toBeGreaterThan(0);
  });
});
