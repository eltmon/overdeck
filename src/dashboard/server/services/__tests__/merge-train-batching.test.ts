/**
 * PAN-4753 D4: the batch window wiring and the batch auto-promote tick.
 * Every dependency is injected; fake timers drive the window clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../../../lib/projects.js';
import type { UatGeneration } from '../../../../lib/overdeck/merge-sync.js';
import type { CommitCheckRuns } from '../../../../lib/overdeck/pull-requests.js';
import type { ReadyFeature } from '../../../../lib/cloister/uat-generation-engine.js';

vi.mock('../issue-service-singleton.js', () => ({ getSharedIssueService: () => ({ getTrackerIssue: () => null }) }));

const { buildSelectBatch, _resetBatchWindowClockForTests } = await import('../merge-train-batching.js');
const { runBatchAutoPromoteTick, batchCiVerdict, memberToDrop } = await import('../batch-auto-promote.js');
const { droppedFromBatch, mergeRouteFor } = await import('../../../../lib/cloister/merge-route.js');

const MIN = 60_000;
const PROJECT: ProjectConfig = { name: 'Overdeck', path: '/repos/overdeck', auto_merge_default: 'auto' };
const feature = (n: number): ReadyFeature => ({ issueId: `PAN-${n}`, title: `t${n}`, branch: `feature/pan-${n}` });

function generation(ids: number[], overrides: Partial<UatGeneration> = {}): UatGeneration {
  return {
    name: 'uat/pan-otter-1114', worktreePath: '/repos/overdeck/workspaces/uat-pan-otter-1114', projectRoot: '/repos/overdeck',
    baseSha: 'base', status: 'ready',
    members: ids.map((n, i) => ({ issueId: `PAN-${n}`, title: `t${n}`, branch: `feature/pan-${n}`, headSha: `h${n}`, mergeOrder: i + 1 })),
    heldOut: [], resolutions: [], stackStartedAt: null,
    createdAt: '2026-11-14T12:00:00Z', updatedAt: '2026-11-14T12:00:00Z',
    ...overrides,
  };
}

function runs(partial: Partial<CommitCheckRuns>): CommitCheckRuns {
  const names = partial.names ?? [...(partial.successful ?? []), ...(partial.failed ?? []), ...(partial.pending ?? [])];
  return { total: names.length, names, successful: [], failed: [], pending: [], ...partial };
}

describe('buildSelectBatch (window wiring)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
    _resetBatchWindowClockForTests();
  });
  afterEach(() => vi.useRealTimers());

  const base = {
    forgeOf: () => 'github' as const,
    isRequireUatBeforeMerge: () => false,
    getIssueLabels: () => [] as string[],
    batchSize: () => 3,
    batchWaitMinutes: () => 30,
  };

  it('waits, then batches the oldest ready features once M elapses (ready-since from the rollup)', async () => {
    const readyAt = new Date().toISOString();
    const listOpenPrs = async () => [1, 2].map((n) => ({
      headRefName: `feature/pan-${n}`, headRefOid: `h${n}`,
      statusCheckRollup: [{ conclusion: 'SUCCESS', completedAt: readyAt }],
    }));
    const select = buildSelectBatch('/repos/overdeck', PROJECT, { ...base, listOpenPrs, now: () => Date.now() });
    expect(await select([feature(1), feature(2)], [])).toEqual({ wait: '2 of 3 ready; oldest waited 0 of 30 min' });
    vi.advanceTimersByTime(30 * MIN);
    expect(await select([feature(1), feature(2)], [])).toEqual({ features: [feature(1), feature(2)] });
  });

  it('batches at N without waiting', async () => {
    const select = buildSelectBatch('/repos/overdeck', PROJECT, { ...base, listOpenPrs: async () => [], now: () => Date.now() });
    expect(await select([feature(1), feature(2), feature(3)], [])).toEqual({ features: [feature(1), feature(2), feature(3)] });
  });

  it('times a PR with no completed checks from the first tick that saw it ready', async () => {
    const select = buildSelectBatch('/repos/overdeck', PROJECT, { ...base, listOpenPrs: async () => [], now: () => Date.now() });
    expect(await select([feature(1)], [])).toHaveProperty('wait');
    vi.advanceTimersByTime(30 * MIN);
    expect(await select([feature(1)], [])).toEqual({ features: [feature(1)] });
  });

  it('applies no window (null) to a hold project, a GitLab or polyrepo project, or a batch with a held feature', async () => {
    const opts = { ...base, listOpenPrs: async () => [], now: () => Date.now() };
    expect(await buildSelectBatch('/repos/myn', { ...PROJECT, auto_merge_default: 'hold' }, opts)([feature(1)], [])).toBeNull();
    expect(await buildSelectBatch('/repos/x', PROJECT, { ...opts, forgeOf: () => 'gitlab' })([feature(1)], [])).toBeNull();
    expect(await buildSelectBatch('/repos/x', { ...PROJECT, workspace: { type: 'polyrepo' } }, opts)([feature(1)], [])).toBeNull();
    const held = { ...opts, getIssueLabels: (id: string) => (id === 'PAN-2' ? ['hold-for-uat'] : []) };
    expect(await buildSelectBatch('/repos/overdeck', PROJECT, held)([feature(1), feature(2)], [])).toBeNull();
  });
});

describe('batchCiVerdict', () => {
  it('is green when every gating check passed, ignoring CodeRabbit and the non-blocking flake lane', () => {
    expect(batchCiVerdict(runs({
      names: ['build', 'test', 'CodeRabbit', 'Non-blocking flake lane'],
      successful: ['build', 'test'],
      failed: ['CodeRabbit', 'Non-blocking flake lane'],
    }))).toBe('green');
  });

  it('is pending with no gating checks reported, or any still running', () => {
    expect(batchCiVerdict(runs({ names: [] }))).toBe('pending');
    expect(batchCiVerdict(runs({ names: ['CodeRabbit'], pending: ['CodeRabbit'] }))).toBe('pending');
    expect(batchCiVerdict(runs({ names: ['build', 'test'], successful: ['build'], pending: ['test'] }))).toBe('pending');
  });

  it('names the failed gating checks', () => {
    expect(batchCiVerdict(runs({ names: ['build', 'test'], successful: ['build'], failed: ['test'] }))).toEqual({ failed: ['test'] });
  });
});

describe('runBatchAutoPromoteTick', () => {
  function tick(opts: {
    gen?: UatGeneration | null;
    checks?: CommitCheckRuns;
    labels?: Record<string, string[]>;
    trainOn?: boolean;
    config?: ProjectConfig;
  }) {
    const promote = vi.fn(async (name: string) => ({
      success: true as const, generation: name, mergeSha: 'm', members: [], postMergeStarted: [], invalidated: [],
    }));
    const markDropped = vi.fn();
    const teardownStack = vi.fn(async () => {});
    const run = runBatchAutoPromoteTick(vi.fn(), {
      env: {},
      listProjects: () => [{ key: 'overdeck', config: opts.config ?? PROJECT }],
      isTrainOn: () => opts.trainOn ?? true,
      forgeOf: () => 'github',
      isRequireUatBeforeMerge: () => false,
      getIssueLabels: (id) => opts.labels?.[id] ?? [],
      listReady: () => (opts.gen === null ? [] : [opts.gen ?? generation([1, 2, 3])]),
      branchHead: async () => 'headsha',
      checkRuns: async () => opts.checks ?? runs({ names: ['build', 'test'], successful: ['build', 'test'] }),
      promote,
      markDropped,
      teardownStack,
      log: () => {},
    });
    return { run, promote, markDropped, teardownStack };
  }

  it('merges a batch whose combined CI is green', async () => {
    const { run, promote, markDropped } = tick({});
    await expect(run).resolves.toEqual([{ projectKey: 'overdeck', generation: 'uat/pan-otter-1114', action: 'promoted' }]);
    expect(promote).toHaveBeenCalledWith('uat/pan-otter-1114');
    expect(markDropped).not.toHaveBeenCalled();
  });

  it('waits while the combined CI is still running', async () => {
    const { run, promote } = tick({ checks: runs({ names: ['build', 'test'], successful: ['build'], pending: ['test'] }) });
    await expect(run).resolves.toEqual([{ projectKey: 'overdeck', generation: 'uat/pan-otter-1114', action: 'waiting-ci' }]);
    expect(promote).not.toHaveBeenCalled();
  });

  it('drops the last member when the combined CI fails; the rest are not blocked', async () => {
    const gen = generation([1, 2, 3]);
    const { run, promote, markDropped, teardownStack } = tick({
      gen, checks: runs({ names: ['build', 'test'], successful: ['build'], failed: ['test'] }),
    });
    const [outcome] = await run;
    expect(outcome).toMatchObject({ action: 'dropped', issueId: 'PAN-3' });
    expect(promote).not.toHaveBeenCalled();
    expect(teardownStack).toHaveBeenCalledWith(gen);
    const heldOut = markDropped.mock.calls[0]![1] as UatGeneration['heldOut'];
    expect(heldOut).toEqual([{
      issueId: 'PAN-3', branch: 'feature/pan-3', headSha: 'h3',
      reason: 'combined CI failed on uat/pan-otter-1114 (test); PAN-3 merges on its own',
    }]);

    // The stored drop routes PAN-3 per-PR; PAN-1 and PAN-2 stay on the batch path.
    const invalidated = [{ ...gen, status: 'invalidated' as const, heldOut }];
    const routeOf = (id: string) => mergeRouteFor({
      heldForUat: false, trainOn: true, highPriority: false,
      droppedFromBatch: droppedFromBatch(id, '/repos/overdeck', { listInvalidated: () => invalidated }),
    });
    expect(routeOf('PAN-3')).toBe('per-pr');
    expect(routeOf('PAN-1')).toBe('batch');
    expect(routeOf('PAN-2')).toBe('batch');
  });

  it('never auto-merges a batch with a member held for UAT', async () => {
    const { run, promote } = tick({ labels: { 'PAN-2': ['hold-for-uat'] } });
    await expect(run).resolves.toEqual([{ projectKey: 'overdeck', generation: 'uat/pan-otter-1114', action: 'held', detail: 'PAN-2' }]);
    expect(promote).not.toHaveBeenCalled();
  });

  it('does nothing with the train off, in a hold project, or with no ready batch', async () => {
    for (const opts of [{ trainOn: false }, { config: { ...PROJECT, auto_merge_default: 'hold' as const } }, { gen: null }]) {
      const { run, promote } = tick(opts);
      await expect(run).resolves.toEqual([]);
      expect(promote).not.toHaveBeenCalled();
    }
  });

  it('stops entirely under the auto-merge kill switch', async () => {
    const promote = vi.fn();
    await expect(runBatchAutoPromoteTick(vi.fn(), { env: { OVERDECK_DISABLE_AUTO_MERGE: '1' }, promote })).resolves.toEqual([]);
    expect(promote).not.toHaveBeenCalled();
  });

  it('drops a lone failing member', () => {
    expect(memberToDrop(generation([7]))?.issueId).toBe('PAN-7');
  });
});
