import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  postMergeLifecycle: vi.fn(),
  resolveCanonicalReviewStatus: vi.fn(),
}));

vi.mock('../review-status-source.js', () => ({
  resolveCanonicalReviewStatus: mocks.resolveCanonicalReviewStatus,
}));

vi.mock('../merge-agent.js', () => ({
  postMergeLifecycle: mocks.postMergeLifecycle,
}));

import {
  enqueuePostMergeLifecycle,
  resetPostMergeLifecycleWorkerForTests,
  waitForPostMergeLifecycleIdleForTests,
} from '../post-merge-lifecycle-worker.js';

describe('post-merge lifecycle worker', () => {
  beforeEach(async () => {
    await resetPostMergeLifecycleWorkerForTests();
    vi.clearAllMocks();
    mocks.resolveCanonicalReviewStatus.mockReturnValue({
      available: true,
      status: { mergeStatus: 'merged', mergeStep: 'post-merge-cleanup' },
    });
    mocks.postMergeLifecycle.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await resetPostMergeLifecycleWorkerForTests();
  });

  it('deduplicates issues and runs lifecycle retries serially', async () => {
    let active = 0;
    let maxActive = 0;
    mocks.postMergeLifecycle.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
    });

    expect(enqueuePostMergeLifecycle('PAN-5559', '/repo', 'feature/pan-5559'))
      .toBe('Queued pending post-merge lifecycle for PAN-5559');
    expect(enqueuePostMergeLifecycle('pan-5559', '/repo', 'feature/pan-5559')).toBeNull();
    enqueuePostMergeLifecycle('PAN-5560', '/repo', 'feature/pan-5560');
    await waitForPostMergeLifecycleIdleForTests();

    expect(mocks.postMergeLifecycle.mock.calls).toEqual([
      ['PAN-5559', '/repo', 'feature/pan-5559', { skipDeploy: true }],
      ['PAN-5560', '/repo', 'feature/pan-5560', { skipDeploy: true }],
    ]);
    expect(maxActive).toBe(1);
  });

  it('allows a later patrol to requeue a failed lifecycle', async () => {
    mocks.postMergeLifecycle
      .mockRejectedValueOnce(new Error('tracker unavailable'))
      .mockResolvedValueOnce(undefined);

    enqueuePostMergeLifecycle('PAN-5559', '/repo', 'feature/pan-5559');
    await waitForPostMergeLifecycleIdleForTests();
    expect(enqueuePostMergeLifecycle('PAN-5559', '/repo', 'feature/pan-5559'))
      .toBe('Queued pending post-merge lifecycle for PAN-5559');
    await waitForPostMergeLifecycleIdleForTests();

    expect(mocks.postMergeLifecycle).toHaveBeenCalledTimes(2);
  });

  it('drops entries whose durable handoff marker is no longer pending', async () => {
    mocks.resolveCanonicalReviewStatus.mockReturnValue({
      available: true,
      status: { mergeStatus: 'merged', mergeStep: 'merged' },
    });

    enqueuePostMergeLifecycle('PAN-5559', '/repo', 'feature/pan-5559');
    await waitForPostMergeLifecycleIdleForTests();

    expect(mocks.postMergeLifecycle).not.toHaveBeenCalled();
  });
});
