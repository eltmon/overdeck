import { describe, expect, it, vi } from 'vitest';

const mockRun = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/cloister/in-flight-guard.js', () => ({
  createInFlightGuard: () => ({ run: mockRun }),
}));

import { firePostMergeLifecycle } from '../specialists/shared.js';

describe('firePostMergeLifecycle', () => {
  it.each([
    '../outside',
    'PAN-3138/../../outside',
    '/tmp/outside',
    'PAN-3138%2F..%2Foutside',
  ])('rejects invalid issue ID %s before entering the lifecycle guard', (issueId) => {
    expect(firePostMergeLifecycle(issueId)).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
