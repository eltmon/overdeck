import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPipelineMembershipService,
  PIPELINE_MEMBERSHIP_TTL_MS,
} from '../../../src/dashboard/server/services/pipeline-membership.js';

describe('pipeline membership service', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('caches classified membership within the TTL and refreshes after expiry', async () => {
    const gather = vi.fn().mockResolvedValue([{
      issueId: 'PAN-1', issueOpen: true, hasOpenPr: true, hasMergedPr: false,
      hasConventionBranch: true, branchUnmerged: true, phaseLabel: 'in-review', hasVbriefSpec: true,
    }]);
    const getMembership = createPipelineMembershipService({ gather, now: Date.now });
    const project = { name: 'overdeck', path: '/project', github_repo: 'eltmon/overdeck', issue_prefix: 'PAN' };

    const first = await getMembership(project);
    const second = await getMembership(project);
    expect(gather).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ issueId: 'PAN-1', inPipeline: true, bucket: 'in_flight', labelDrift: null });

    await vi.advanceTimersByTimeAsync(PIPELINE_MEMBERSHIP_TTL_MS + 1);
    await getMembership(project);
    expect(gather).toHaveBeenCalledTimes(2);
  });
});
