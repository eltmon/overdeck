import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPipelineMembershipService,
  getPipelineMembershipForProjects,
  PIPELINE_MEMBERSHIP_TTL_MS,
  summarizePipelineMembership,
} from '../../../src/dashboard/server/services/pipeline-membership.js';

describe('pipeline membership service', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('projects the authoritative result onto the issue DTO contract', () => {
    expect(summarizePipelineMembership({
      issueId: 'PAN-1966',
      inPipeline: true,
      bucket: 'post_merge_limbo',
      reasons: ['merged but open'],
      labelDrift: 'stale_absent',
      lenses: { L1_openPr: false, L2_unmergedBranch: false, L3_issueOpen: true, L4_phaseLabel: null },
    })).toEqual({ inPipeline: true, bucket: 'post_merge_limbo', labelDrift: 'stale_absent' });
  });

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

  it('treats non-GitHub projects as empty without invoking the GitHub gatherer', async () => {
    const gather = vi.fn();
    const getMembership = createPipelineMembershipService({ gather, now: Date.now });

    await expect(getMembership({
      name: 'linear-project',
      path: '/linear-project',
      issue_prefix: 'MIN',
    })).resolves.toEqual([]);
    expect(gather).not.toHaveBeenCalled();
  });

  it('collects mixed-project membership for the issues route without rejecting non-GitHub projects', async () => {
    const projects = [
      { name: 'overdeck', path: '/overdeck', issue_prefix: 'PAN', github_repo: 'eltmon/overdeck' },
      { name: 'mind-your-now', path: '/myn', issue_prefix: 'MIN' },
    ];
    const getMembership = vi.fn().mockImplementation(async (project: { github_repo?: string }) =>
      project.github_repo ? [{ issueId: 'PAN-1966' }] : []);

    await expect(getPipelineMembershipForProjects(projects, getMembership)).resolves.toEqual([
      { issueId: 'PAN-1966' },
    ]);
    expect(getMembership).toHaveBeenCalledTimes(2);
  });
});
