import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';

import { evaluateSeverity, readTrackerQuota } from '../system-health-service.js';
import type { CacheService as CacheServiceType } from '../cache-service.js';

const thresholds = {
  memoryAvailableWarningBytes: 4 * 1024 ** 3,
  memoryAvailableCriticalBytes: 2 * 1024 ** 3,
  swapUsedWarningPercent: 50,
  swapUsedCriticalPercent: 80,
  cpuLoadWarningPerCore: 2,
  cpuLoadCriticalPerCore: 4,
  overcommitWarningPercent: 80,
  overcommitCriticalPercent: 95,
};

const baseData = {
  availableMemoryBytes: 8 * 1024 ** 3,
  swapUsedPercent: 0,
  loadPerCore1m: 0.5,
  overcommitPercent: 10,
  leakedSpecialistCount: 0,
};

// Wrap the whole file in sequential execution so the readTrackerQuota tests can
// safely set process.env.PANOPTICON_HOME before dynamically importing CacheService.
describe.sequential('system-health quota signal (PAN-1817)', () => {
  describe('evaluateSeverity tracker quota (PAN-1817)', () => {
    it('raises warning when a tracker is quota_exhausted', () => {
      const result = evaluateSeverity(thresholds, {
        ...baseData,
        trackerQuota: { exhaustedTrackers: ['linear'], githubRemaining: null },
      });
      expect(result.severity).toBe('warning');
      expect(result.reasons.some((r) => r.includes('Linear API quota exhausted'))).toBe(true);
    });

    it('raises warning when GitHub remaining is zero', () => {
      const result = evaluateSeverity(thresholds, {
        ...baseData,
        trackerQuota: { exhaustedTrackers: [], githubRemaining: 0 },
      });
      expect(result.severity).toBe('warning');
      expect(result.reasons.some((r) => r.includes('GitHub API rate limit is exhausted'))).toBe(true);
    });

    it('stays normal when no tracker quota signals are present', () => {
      const result = evaluateSeverity(thresholds, {
        ...baseData,
        trackerQuota: { exhaustedTrackers: [], githubRemaining: null },
      });
      expect(result.severity).toBe('normal');
      expect(result.reasons).toHaveLength(0);
    });

    it('includes multiple exhausted tracker reasons', () => {
      const result = evaluateSeverity(thresholds, {
        ...baseData,
        trackerQuota: { exhaustedTrackers: ['linear', 'rally'], githubRemaining: null },
      });
      expect(result.severity).toBe('warning');
      expect(result.reasons.some((r) => r.includes('Linear'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('Rally'))).toBe(true);
    });
  });

  describe('readTrackerQuota (PAN-1817)', () => {
    let testHome: string;
    let cache: CacheServiceType | null = null;

    beforeEach(() => {
      vi.resetModules();
      testHome = `/tmp/pan-1817-shq-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      mkdirSync(testHome, { recursive: true });
      process.env.PANOPTICON_HOME = testHome;
    });

    afterEach(() => {
      cache?.close();
      delete process.env.PANOPTICON_HOME;
      rmSync(testHome, { recursive: true, force: true });
    });

    it('reads recent, stale, and non-quota poll-health records from CacheService', async () => {
      const { CacheService } = await import('../cache-service.js');
      cache = new CacheService();

      // 1. Recent quota_exhausted record is surfaced.
      cache.recordPollHealth('linear', { status: 'quota_exhausted', message: 'rate limited' });
      expect(readTrackerQuota(cache).exhaustedTrackers).toEqual(['linear']);

      // 2. Stale record is ignored.
      cache.recordPollHealth('linear', { status: 'quota_exhausted', message: 'old' });
      (cache as any).db
        .prepare("UPDATE tracker_poll_health SET observed_at = ? WHERE tracker = 'linear'")
        .run(new Date(Date.now() - 10 * 60 * 1000).toISOString());
      expect(readTrackerQuota(cache).exhaustedTrackers).toEqual([]);

      // 3. Non-quota statuses are ignored.
      cache.recordPollHealth('github', { status: 'error', message: 'timeout' });
      expect(readTrackerQuota(cache).exhaustedTrackers).toEqual([]);

      // 4. GitHub remaining is reported only while the reset window is in the future.
      cache.updateRateLimit('github', {
        remaining: 0,
        total: 5000,
        resetAt: new Date(Date.now() + 60 * 1000).toISOString(),
      });
      expect(readTrackerQuota(cache).githubRemaining).toBe(0);

      cache.updateRateLimit('github', {
        remaining: 0,
        total: 5000,
        resetAt: new Date(Date.now() - 60 * 1000).toISOString(),
      });
      expect(readTrackerQuota(cache).githubRemaining).toBeNull();

      // 5. Unparseable/missing resetAt is treated as still exhausted.
      cache.updateRateLimit('github', {
        remaining: 0,
        total: 5000,
        resetAt: 'invalid',
      });
      expect(readTrackerQuota(cache).githubRemaining).toBe(0);
    });
  });
});
