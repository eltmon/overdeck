/**
 * #4040 review: the PR-tab cache also expires after a minute, so a verdict
 * comment posted where no webhook reaches this process still reaches the merge
 * gate, which reads PR comments through `fetchIssuePullRequest`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PR_TAB_CACHE_TTL_MS,
  bumpIssuePrTabCacheGeneration,
  clearIssuePrTabCacheForTests,
  getCachedIssuePrTabResponse,
  getIssuePrTabCacheGeneration,
  setCachedIssuePrTabResponse,
} from '../pr-tab-cache.js';

describe('pr-tab-cache expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    clearIssuePrTabCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves an entry within the TTL and drops it once the TTL passes', () => {
    const generation = getIssuePrTabCacheGeneration('PAN-4036');
    setCachedIssuePrTabResponse('pr', 'PAN-4036', generation, { pr: 'before-verdict' });

    vi.advanceTimersByTime(PR_TAB_CACHE_TTL_MS - 1);
    expect(getCachedIssuePrTabResponse('pr', 'PAN-4036', generation)).toEqual({ pr: 'before-verdict' });

    vi.advanceTimersByTime(1);
    expect(getCachedIssuePrTabResponse('pr', 'PAN-4036', generation)).toBeNull();
  });

  it('still drops an entry at once when a webhook bumps the generation', () => {
    const generation = getIssuePrTabCacheGeneration('PAN-4036');
    setCachedIssuePrTabResponse('pr', 'PAN-4036', generation, { pr: 'before-verdict' });
    bumpIssuePrTabCacheGeneration('PAN-4036');
    expect(getCachedIssuePrTabResponse('pr', 'PAN-4036', getIssuePrTabCacheGeneration('PAN-4036'))).toBeNull();
  });
});
