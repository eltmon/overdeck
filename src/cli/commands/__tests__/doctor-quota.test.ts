import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkTrackerQuota } from '../doctor.js';
import type { PollHealth, RateLimitInfo } from '../../../dashboard/server/services/cache-service.js';

const mockPollHealth = new Map<string, PollHealth>();
const mockRateLimits = new Map<string, RateLimitInfo>();

vi.mock('../../../dashboard/server/services/cache-service.js', () => ({
  DEFAULT_TTLS: { github: 60, linear: 30, rally: 120 },
  CacheService: class MockCacheService {
    recordPollHealth(tracker: string, health: PollHealth): void {
      mockPollHealth.set(tracker, health);
    }

    getPollHealth(tracker: string): PollHealth | null {
      return mockPollHealth.get(tracker) ?? null;
    }

    updateRateLimit(tracker: string, info: RateLimitInfo): void {
      mockRateLimits.set(tracker, info);
    }

    getRateLimit(tracker: string): RateLimitInfo | null {
      return mockRateLimits.get(tracker) ?? null;
    }

    close(): void {}
  },
}));

describe('doctor checkTrackerQuota (PAN-1817)', () => {
  beforeEach(() => {
    mockPollHealth.clear();
    mockRateLimits.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok when no tracker reports quota exhaustion', () => {
    const result = checkTrackerQuota();
    expect(result.status).toBe('ok');
    expect(result.name).toBe('Tracker Quota');
    expect(result.message).toMatch(/no tracker quota/i);
  });

  it('warns when linear poll health is quota_exhausted', () => {
    mockPollHealth.set('linear', { status: 'quota_exhausted', message: 'rate limit hit', observedAt: new Date().toISOString() });

    const result = checkTrackerQuota();
    expect(result.status).toBe('warn');
    expect(result.name).toBe('Tracker Quota');
    expect(result.message).toMatch(/linear quota exhausted/i);
    expect(result.fix).toMatch(/quota window|rotate|upgrade/i);
  });

  it('warns when GitHub rate limit remaining is zero and reset is in the future', () => {
    mockRateLimits.set('github', {
      remaining: 0,
      total: 5000,
      resetAt: new Date(Date.now() + 60 * 1000).toISOString(),
    });

    const result = checkTrackerQuota();
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/github rate limit exhausted/i);
  });

  it('warns for multiple quota signals at once', () => {
    mockPollHealth.set('linear', { status: 'quota_exhausted', message: 'linear rate limited', observedAt: new Date().toISOString() });
    mockPollHealth.set('rally', { status: 'quota_exhausted', message: 'rally rate limited', observedAt: new Date().toISOString() });

    const result = checkTrackerQuota();
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/linear/i);
    expect(result.message).toMatch(/rally/i);
  });

  it('ignores stale quota_exhausted records', () => {
    const staleObservedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    mockPollHealth.set('linear', { status: 'quota_exhausted', message: 'old rate limit', observedAt: staleObservedAt });

    const result = checkTrackerQuota();
    expect(result.status).toBe('ok');
    expect(result.message).toMatch(/no tracker quota/i);
  });
});
