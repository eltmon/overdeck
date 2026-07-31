import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INTERNAL_TOKEN_HEADER,
  _resetInternalTokenCacheForTests,
} from '../../../lib/internal-token.js';
import { postDoneDashboardJson } from '../done-dashboard-client.js';

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
});
