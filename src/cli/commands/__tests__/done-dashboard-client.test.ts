import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INTERNAL_TOKEN_HEADER,
  _resetInternalTokenCacheForTests,
} from '../../../lib/internal-token.js';
import {
  observeDoneReviewHandoff,
  postDoneDashboardJson,
  waitForDoneReviewHandoff,
} from '../done-dashboard-client.js';

describe('postDoneDashboardJson', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.OVERDECK_INTERNAL_TOKEN = 'test-internal-token';
    _resetInternalTokenCacheForTests();
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
    vi.useRealTimers();
  });

  it('authenticates automatic review dispatch with the internal token', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true }));

    await expect(postDoneDashboardJson(
      'http://localhost:3011',
      '/api/review/PAN-3340/trigger',
      { fetchImpl: fetchImpl as typeof fetch },
    )).resolves.toEqual({ success: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3011/api/review/PAN-3340/trigger',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [INTERNAL_TOKEN_HEADER]: 'test-internal-token',
        }),
      }),
    );
  });

  it('does not accept a pending review when no handler advances the durable status', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      reviewStatus: 'pending',
      verificationStatus: 'pending',
      reviewRequestedAt: '2026-09-09T05:14:00.000Z',
      reviewSpawnedAt: null,
    }));

    const observation = waitForDoneReviewHandoff(
      'http://localhost:3011',
      'MIN-889',
      '2026-09-09T05:14:00.000Z',
      { fetchImpl: fetchImpl as typeof fetch, attempts: 3, intervalMs: 1000 },
    );
    await vi.runAllTimersAsync();

    await expect(observation).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('accepts durable verification ownership or a current review spawn', () => {
    expect(observeDoneReviewHandoff(
      { verificationStatus: 'running' },
      '2026-09-09T05:14:00.000Z',
    )?.kind).toBe('verification');

    expect(observeDoneReviewHandoff(
      { reviewSpawnedAt: '2026-09-09T05:14:01.000Z' },
      '2026-09-09T05:14:00.000Z',
    )?.kind).toBe('review');
  });
});
