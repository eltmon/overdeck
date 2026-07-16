import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPipelineMembershipService,
  getPipelineMembershipForProjects,
  getPipelineMembershipResultsForProjects,
  getPipelineMembershipSnapshotsForProjects,
  getPipelineMembershipSnapshotsForResourceDiscovery,
  PIPELINE_MEMBERSHIP_TTL_MS,
  PIPELINE_MEMBERSHIP_SNAPSHOT_TTL_MS,
  summarizePipelineMembership,
} from '../../../src/dashboard/server/services/pipeline-membership.js';
import { PIPELINE_PROJECT_CONCURRENCY } from '../../../src/lib/pipeline-membership-gather.js';

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
    })).toEqual({ available: true, inPipeline: true, bucket: 'post_merge_limbo', labelDrift: 'stale_absent' });
  });

  it('caches classified membership within the TTL and refreshes after expiry', async () => {
    const gather = vi.fn().mockResolvedValue([{
      issueId: 'PAN-1', issueOpen: true, hasOpenPr: true, hasMergedPr: false,
      hasConventionBranch: true, branchUnmerged: true, phaseLabel: 'in-review', hasVbriefSpec: true, explicitlyReady: false,
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

  it('keeps a slow membership gather single-flight beyond the TTL', async () => {
    let resolve!: (signals: []) => void;
    const gather = vi.fn(() => new Promise<[]>((done) => { resolve = done; }));
    const getMembership = createPipelineMembershipService({ gather, now: Date.now });
    const project = { name: 'slow', path: '/slow', github_repo: 'owner/slow', issue_prefix: 'PAN' };

    const first = getMembership(project);
    await vi.advanceTimersByTimeAsync(PIPELINE_MEMBERSHIP_TTL_MS * 2);
    const second = getMembership(project);

    expect(gather).toHaveBeenCalledOnce();
    resolve([]);
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
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

  it('isolates one project failure in explicit result metadata', async () => {
    const projects = [
      { name: 'healthy', path: '/healthy', github_repo: 'owner/healthy' },
      { name: 'failed', path: '/failed', github_repo: 'owner/failed' },
    ];
    const failure = new Error('GitHub unavailable');
    const getMembership = vi.fn().mockImplementation(async (project: { path: string }) => {
      if (project.path === '/failed') throw failure;
      return [{ issueId: 'PAN-1' }];
    });

    const results = await getPipelineMembershipResultsForProjects(projects, getMembership);

    expect(results[0]).toMatchObject({ project: projects[0], memberships: [{ issueId: 'PAN-1' }] });
    expect(results[1]).toMatchObject({ project: projects[1], error: failure });
  });

  it('returns unavailable on a cold read, then serves the successful snapshot while refreshing', async () => {
    const project = { name: 'snapshot-test', path: '/snapshot-test', github_repo: 'owner/repo' };
    const getMembership = vi.fn().mockResolvedValue([{ issueId: 'PAN-1' }]);

    expect(getPipelineMembershipSnapshotsForProjects([project], getMembership)[0]?.error).toBeInstanceOf(Error);
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(getPipelineMembershipSnapshotsForProjects([project], getMembership)[0]?.memberships).toEqual([{ issueId: 'PAN-1' }]);

    await vi.advanceTimersByTimeAsync(PIPELINE_MEMBERSHIP_SNAPSHOT_TTL_MS + 1);
    expect(getPipelineMembershipSnapshotsForProjects([project], getMembership)[0]?.memberships).toEqual([{ issueId: 'PAN-1' }]);
  });

  it('does not recrawl membership on repeated 30-second resource refreshes', async () => {
    const project = { name: 'resources', path: '/resources', github_repo: 'owner/resources' };
    const getMembership = vi.fn().mockResolvedValue([{ issueId: 'PAN-1' }]);

    await expect(getPipelineMembershipSnapshotsForResourceDiscovery([project], getMembership))
      .resolves.toEqual([{ project, memberships: [{ issueId: 'PAN-1' }] }]);
    await vi.advanceTimersByTimeAsync(30_001);
    await getPipelineMembershipSnapshotsForResourceDiscovery([project], getMembership);
    await vi.advanceTimersByTimeAsync(30_001);
    await getPipelineMembershipSnapshotsForResourceDiscovery([project], getMembership);

    expect(getMembership).toHaveBeenCalledOnce();
  });

  it.each([
    ['issue snapshots', (projects, getMembership) => {
      getPipelineMembershipSnapshotsForProjects(projects, getMembership);
      return Promise.resolve();
    }],
    ['resource snapshots', (projects, getMembership) =>
      getPipelineMembershipSnapshotsForResourceDiscovery(projects, getMembership).then(() => undefined)],
  ] as const)('bounds concurrent multi-project refreshes for %s', async (_name, refresh) => {
    const projects = Array.from({ length: 7 }, (_, index) => ({
      name: `bounded-${_name}-${index}`,
      path: `/bounded-${_name}-${index}`,
      github_repo: `owner/repo-${index}`,
    }));
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const getMembership = vi.fn(() => new Promise<[]>(resolve => {
      active++;
      maxActive = Math.max(maxActive, active);
      releases.push(() => { active--; resolve([]); });
    }));

    const result = refresh(projects, getMembership);
    await vi.waitFor(() => expect(getMembership).toHaveBeenCalledTimes(PIPELINE_PROJECT_CONCURRENCY));
    while (getMembership.mock.calls.length < projects.length) {
      releases.shift()!();
      await vi.waitFor(() => expect(getMembership.mock.calls.length).toBeGreaterThan(active));
    }
    while (releases.length > 0) releases.shift()!();
    await result;

    expect(maxActive).toBe(PIPELINE_PROJECT_CONCURRENCY);
  });
});
