import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CheckResult } from '../../../src/cli/commands/doctor.js';

describe('checkTrackerRateLimits', () => {
  let testDir: string;
  let checkTrackerRateLimits: () => CheckResult;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'doctor-rate-limits-test-'));
    const panopticonHome = join(testDir, '.panopticon');
    mkdirSync(panopticonHome, { recursive: true });
    vi.stubEnv('PANOPTICON_HOME', panopticonHome);
    vi.resetModules();

    const doctor = await import('../../../src/cli/commands/doctor.js');
    checkTrackerRateLimits = doctor.checkTrackerRateLimits;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns ok when no rate limit rows exist', () => {
    const result = checkTrackerRateLimits();

    expect(result).toEqual({
      name: 'Tracker Rate Limits',
      status: 'ok',
      message: 'All trackers within rate limits',
    });
  });

  it('returns warn when a tracker is suspended', async () => {
    const resetAt = new Date(Date.now() + 3_600_000).toISOString();
    const { CacheService } = await import('../../../src/dashboard/server/services/cache-service.js');
    const cache = new CacheService();
    cache.updateRateLimit('linear', { remaining: 0, total: 2500, resetAt });
    cache.close();

    const result = checkTrackerRateLimits();

    expect(result.status).toBe('warn');
    expect(result.name).toBe('Tracker Rate Limits');
    expect(result.message).toContain('linear');
    expect(result.message).toContain('suspended');
    expect(result.message).toContain(resetAt);
  });

  it('returns warn when a tracker should back off', async () => {
    const resetAt = new Date(Date.now() + 3_600_000).toISOString();
    const { CacheService } = await import('../../../src/dashboard/server/services/cache-service.js');
    const cache = new CacheService();
    cache.updateRateLimit('github', { remaining: 40, total: 5000, resetAt });
    cache.close();

    const result = checkTrackerRateLimits();

    expect(result.status).toBe('warn');
    expect(result.message).toContain('github');
    expect(result.message).toContain('backing off');
  });

  it('returns ok when all trackers are within limits', async () => {
    const resetAt = new Date(Date.now() + 3_600_000).toISOString();
    const { CacheService } = await import('../../../src/dashboard/server/services/cache-service.js');
    const cache = new CacheService();
    cache.updateRateLimit('github', { remaining: 4000, total: 5000, resetAt });
    cache.updateRateLimit('linear', { remaining: 2000, total: 2500, resetAt });
    cache.close();

    const result = checkTrackerRateLimits();

    expect(result.status).toBe('ok');
    expect(result.message).toBe('All trackers within rate limits');
  });

  it('returns non-throwing ok/skip result on CacheService error', async () => {
    const { CacheService } = await import('../../../src/dashboard/server/services/cache-service.js');
    const spy = vi.spyOn(CacheService.prototype, 'getSuspensionMs').mockImplementation(() => {
      throw new Error('db locked');
    });

    const result = checkTrackerRateLimits();
    spy.mockRestore();

    expect(result.status).toBe('ok');
    expect(result.name).toBe('Tracker Rate Limits');
    expect(result.message).toMatch(/^Skipped \(/);
  });
});
