import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetDeployStalenessForTests,
  getDeployStaleness,
} from '../system-health-service.js';
import type { BuildStaleness } from '../../../../lib/deploy/staleness.js';

const STALENESS: BuildStaleness = {
  status: 'stale',
  buildCommit: 'build-sha',
  originMainSha: 'origin-sha',
  behindTotal: 4,
  behindBuildInputs: 2,
  originMainLastCommitAt: 1_710_000_000_000,
  computedAt: 1_752_580_800_000,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
});

afterEach(() => {
  _resetDeployStalenessForTests();
  vi.useRealTimers();
});

describe('deploy staleness health surface', () => {
  it('returns the build and origin/main comparison fields', async () => {
    const compute = vi.fn().mockResolvedValue(STALENESS);
    _resetDeployStalenessForTests(compute);

    await expect(getDeployStaleness()).resolves.toEqual(STALENESS);
  });

  it('returns null instead of rejecting when Git computation throws', async () => {
    _resetDeployStalenessForTests(vi.fn().mockRejectedValue(new Error('git unavailable')));

    await expect(getDeployStaleness()).resolves.toBeNull();
  });

  it('caches the staleness result for 60 seconds', async () => {
    const compute = vi.fn().mockResolvedValue(STALENESS);
    _resetDeployStalenessForTests(compute);

    await getDeployStaleness();
    await vi.advanceTimersByTimeAsync(59_999);
    await getDeployStaleness();

    expect(compute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await getDeployStaleness();
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
