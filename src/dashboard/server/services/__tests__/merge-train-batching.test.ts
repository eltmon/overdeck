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

const {
  buildSelectBatch, _resetBatchWindowClockForTests, isWindowBatch, laneStore, splitReadySetByHold, combineLaneResults,
} = await import('../merge-train-batching.js');
const { reconcileUatGenerations } = await import('../../../../lib/cloister/uat-reconciler.js');
const { chooseBatch } = await import('../../../../lib/cloister/batch-window.js');
type GenerationStorePort = import('../../../../lib/cloister/uat-generation-engine.js').GenerationStorePort;
const { runBatchAutoPromoteTick, batchCiVerdict, failedGatingChecks, memberToDrop } = await import('../batch-auto-promote.js');
type WorkflowRunSummary = import('../batch-auto-promote.js').WorkflowRunSummary;
const { droppedFromBatch, mergeRouteFor } = await import('../../../../lib/cloister/merge-route.js');

const MIN = 60_000;
const PROJECT: ProjectConfig = { name: 'Overdeck', path: '/repos/overdeck', auto_merge_default: 'auto' };
const feature = (n: number): ReadyFeature => ({ issueId: `PAN-${n}`, title: `t${n}`, branch: `feature/pan-${n}` });

function generation(ids: number[], overrides: Partial<UatGeneration> = {}): UatGeneration {
  return {
    name: 'uat/pan-train-otter-1114', worktreePath: '/repos/overdeck/workspaces/uat-pan-train-otter-1114', projectRoot: '/repos/overdeck',
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

  it('applies no window (null) to a hold project, or a GitLab or polyrepo project', async () => {
    const opts = { ...base, listOpenPrs: async () => [], now: () => Date.now() };
    expect(await buildSelectBatch('/repos/myn', { ...PROJECT, auto_merge_default: 'hold' }, opts)([feature(1)], [])).toBeNull();
    expect(await buildSelectBatch('/repos/x', PROJECT, { ...opts, forgeOf: () => 'gitlab' })([feature(1)], [])).toBeNull();
    expect(await buildSelectBatch('/repos/x', { ...PROJECT, workspace: { type: 'polyrepo' } }, opts)([feature(1)], [])).toBeNull();
  });
});

describe('batchCiVerdict (positive evidence from the CI workflow run)', () => {
  const run = (over: Partial<WorkflowRunSummary>): WorkflowRunSummary => ({
    name: 'CI', status: 'completed', conclusion: 'success', run_attempt: 1, created_at: '2026-11-14T12:00:00Z', ...over,
  });

  it('is green only for a completed, successful CI run', () => {
    expect(batchCiVerdict([run({})])).toBe('green');
  });

  it('is pending with no CI run yet, a run in progress, or a cancelled run', () => {
    expect(batchCiVerdict([])).toBe('pending');
    expect(batchCiVerdict([run({ name: 'Windows smoke' })])).toBe('pending');
    expect(batchCiVerdict([run({ status: 'in_progress', conclusion: null })])).toBe('pending');
    expect(batchCiVerdict([run({ conclusion: 'cancelled' })])).toBe('pending');
  });

  it('is failed for a failed or timed-out run', () => {
    expect(batchCiVerdict([run({ conclusion: 'failure' })])).toBe('failed');
    expect(batchCiVerdict([run({ conclusion: 'timed_out' })])).toBe('failed');
  });

  it('lets the newest run decide (a re-run after a failure)', () => {
    expect(batchCiVerdict([
      run({ conclusion: 'failure', created_at: '2026-11-14T12:00:00Z' }),
      run({ conclusion: 'success', created_at: '2026-11-14T12:30:00Z' }),
    ])).toBe('green');
    expect(batchCiVerdict([
      run({ conclusion: 'failure', run_attempt: 1 }),
      run({ status: 'queued', conclusion: null, run_attempt: 2 }),
    ])).toBe('pending');
  });

  it('names failed gating checks, leaving out CodeRabbit and the non-blocking flake lane', () => {
    expect(failedGatingChecks(runs({ failed: ['test', 'CodeRabbit', 'Non-blocking flake lane'] }))).toEqual(['test']);
  });
});

describe('runBatchAutoPromoteTick', () => {
  function tick(opts: {
    gen?: UatGeneration | null;
    ci?: WorkflowRunSummary[];
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
      workflowRuns: async () => opts.ci ?? [{ name: 'CI', status: 'completed', conclusion: 'success' }],
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
    await expect(run).resolves.toEqual([{ projectKey: 'overdeck', generation: 'uat/pan-train-otter-1114', action: 'promoted' }]);
    expect(promote).toHaveBeenCalledWith('uat/pan-train-otter-1114');
    expect(markDropped).not.toHaveBeenCalled();
  });

  it('waits while the combined CI is still running', async () => {
    const { run, promote } = tick({ ci: [{ name: 'CI', status: 'in_progress', conclusion: null }] });
    await expect(run).resolves.toEqual([{ projectKey: 'overdeck', generation: 'uat/pan-train-otter-1114', action: 'waiting-ci' }]);
    expect(promote).not.toHaveBeenCalled();
  });

  it('drops the last member when the combined CI fails; the rest are not blocked', async () => {
    const gen = generation([1, 2, 3]);
    const { run, promote, markDropped, teardownStack } = tick({
      gen,
      ci: [{ name: 'CI', status: 'completed', conclusion: 'failure' }],
      checks: runs({ names: ['build', 'test', 'CodeRabbit'], successful: ['build'], failed: ['test', 'CodeRabbit'] }),
    });
    const [outcome] = await run;
    expect(outcome).toMatchObject({ action: 'dropped', issueId: 'PAN-3' });
    expect(promote).not.toHaveBeenCalled();
    expect(teardownStack).toHaveBeenCalledWith(gen);
    const { members, heldOut } = markDropped.mock.calls[0]![1] as Pick<UatGeneration, 'members' | 'heldOut'>;
    expect(members.map((m) => m.issueId)).toEqual(['PAN-1', 'PAN-2']);
    expect(heldOut).toEqual([{
      issueId: 'PAN-3', branch: 'feature/pan-3', headSha: 'h3',
      reason: 'combined CI failed on uat/pan-train-otter-1114 (test); PAN-3 merges on its own',
    }]);

    // The stored drop routes PAN-3 per-PR; PAN-1 and PAN-2 stay on the batch path.
    const invalidated = [{ ...gen, status: 'invalidated' as const, members, heldOut }];
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
    await expect(run).resolves.toEqual([{ projectKey: 'overdeck', generation: 'uat/pan-train-otter-1114', action: 'held', detail: 'PAN-2' }]);
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

  it('never runs two ticks at once: a tick during a slow promote returns at once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const promote = vi.fn(async (name: string) => {
      await gate;
      return { success: true as const, generation: name, mergeSha: 'm', members: [], postMergeStarted: [], invalidated: [] };
    });
    const deps = {
      env: {},
      listProjects: () => [{ key: 'overdeck', config: PROJECT }],
      isTrainOn: () => true,
      forgeOf: () => 'github' as const,
      isRequireUatBeforeMerge: () => false,
      getIssueLabels: () => [] as string[],
      listReady: () => [generation([1, 2, 3])],
      branchHead: async () => 'headsha',
      workflowRuns: async () => [{ name: 'CI', status: 'completed', conclusion: 'success' }],
      promote,
      log: () => {},
    };
    const first = runBatchAutoPromoteTick(vi.fn(), deps);
    await vi.waitFor(() => expect(promote).toHaveBeenCalledTimes(1));
    await expect(runBatchAutoPromoteTick(vi.fn(), deps)).resolves.toEqual([]);
    release();
    await expect(first).resolves.toEqual([{ projectKey: 'overdeck', generation: 'uat/pan-train-otter-1114', action: 'promoted' }]);
    expect(promote).toHaveBeenCalledTimes(1);
  });

  it('never auto-promotes a UAT-lane batch of held features, even with green CI', async () => {
    const { run, promote } = tick({ gen: generation([1], { name: 'uat/pan-otter-1114' }) });
    await expect(run).resolves.toEqual([]);
    expect(promote).not.toHaveBeenCalled();
  });

  it('drops a lone failing member', () => {
    expect(memberToDrop(generation([7]))?.issueId).toBe('PAN-7');
  });
});

describe('two lanes: a held feature never delays the rest (operator, 2026-11-14)', () => {
  it('names and filters the lanes', () => {
    expect(isWindowBatch('uat/pan-train-otter-1114')).toBe(true);
    expect(isWindowBatch('uat/pan-train-otter-1114-2')).toBe(true);
    expect(isWindowBatch('uat/pan-otter-1114')).toBe(false);
    const held = { getIssueLabels: (id: string) => (id === 'PAN-4' ? ['hold-for-uat'] : []), isRequireUatBeforeMerge: () => false };
    expect(splitReadySetByHold([1, 2, 3, 4].map(feature), PROJECT, held)).toEqual({
      window: [feature(1), feature(2), feature(3)], uat: [feature(4)],
    });
  });

  it('reports the lane that acted, with both lanes\' invalidations', () => {
    expect(combineLaneResults(
      { action: 'assembled', invalidated: ['a'] },
      { action: 'idle', invalidated: ['b'] },
    )).toEqual({ action: 'assembled', invalidated: ['a', 'b'] });
    expect(combineLaneResults(
      { action: 'waiting', invalidated: [] },
      { action: 'assembled', invalidated: [] },
    ).action).toBe('assembled');
  });

  it('one held + three unheld ready: the three merge as a window batch; the held one waits in its UAT batch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
    try {
      const root = '/repos/overdeck';
      const rows = new Map<string, UatGeneration>();
      const store: GenerationStorePort = {
        insert: (g) => { rows.set(g.name, { ...g, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); },
        update: (name, patch) => { rows.set(name, { ...rows.get(name)!, ...patch }); },
        listNames: () => [...rows.keys()],
        listChain: (projectRoot, statuses) => [...rows.values()]
          .filter((g) => g.projectRoot === projectRoot && (!statuses || statuses.includes(g.status)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
      const labels = (id: string) => (id === 'PAN-4' ? ['hold-for-uat'] : []);
      const ready = [1, 2, 3, 4].map(feature);
      const lanes = splitReadySetByHold(ready, PROJECT, { getIssueLabels: labels, isRequireUatBeforeMerge: () => false });
      const laneDeps = (lane: 'window' | 'uat') => {
        const own = laneStore(store, lane);
        return {
          laneKey: lane,
          isEnabled: () => true,
          getReadySet: async () => lanes[lane],
          getMainHeadSha: async () => 'main',
          getBranchHeadSha: async (branch: string) => `head-${branch}`,
          store: own,
          assemble: async (features: readonly ReadyFeature[]) => {
            // As the engine does: insert, push, then supersede older `ready` rows in its own store.
            const name = lane === 'window' ? `uat/pan-train-otter-1114-${rows.size + 1}` : `uat/pan-otter-1114-${rows.size + 1}`;
            const gen = generation([], {
              name, baseSha: 'main', status: 'ready',
              members: features.map((f, i) => ({ issueId: f.issueId, title: f.title, branch: f.branch, headSha: `head-${f.branch}`, mergeOrder: i + 1 })),
            });
            for (const older of own.listChain(root, ['ready'])) own.update(older.name, { status: 'superseded' });
            store.insert(gen);
            return rows.get(name)!;
          },
          teardownStack: async () => {},
          cleanup: async () => {},
          holdsForUat: (f: ReadyFeature) => labels(f.issueId).includes('hold-for-uat'),
          ...(lane === 'window'
            ? {
                selectBatch: async (features: readonly ReadyFeature[], live: readonly UatGeneration[]) => chooseBatch({
                  features, live, size: 3, waitMs: 30 * MIN, now: Date.now(),
                  readySince: new Map(features.map((f) => [f.issueId, Date.now()])),
                }),
              }
            : {}),
          now: () => Date.now(),
        };
      };

      // The window lane assembles the three unheld features at N = 3 at once;
      // the UAT lane gives the held one its own one-member UAT batch.
      expect((await reconcileUatGenerations(root, laneDeps('window'))).action).toBe('assembled');
      expect((await reconcileUatGenerations(root, laneDeps('uat'))).action).toBe('assembled');
      const windowBatch = [...rows.values()].find((g) => isWindowBatch(g.name))!;
      const uatBatch = [...rows.values()].find((g) => !isWindowBatch(g.name))!;
      expect(windowBatch.members.map((m) => m.issueId)).toEqual(['PAN-1', 'PAN-2', 'PAN-3']);
      expect(uatBatch.members.map((m) => m.issueId)).toEqual(['PAN-4']);
      // Neither assembly superseded the other lane's batch.
      expect(windowBatch.status).toBe('ready');
      expect(uatBatch.status).toBe('ready');

      // Combined CI green: the tick merges the window batch and leaves the UAT batch for the operator.
      const promote = vi.fn(async (name: string) => ({
        success: true as const, generation: name, mergeSha: 'm', members: [], postMergeStarted: [], invalidated: [],
      }));
      const outcomes = await runBatchAutoPromoteTick(vi.fn(), {
        env: {},
        listProjects: () => [{ key: 'overdeck', config: PROJECT }],
        isTrainOn: () => true,
        forgeOf: () => 'github',
        isRequireUatBeforeMerge: () => false,
        getIssueLabels: labels,
        listReady: (projectRoot) => store.listChain(projectRoot, ['ready']),
        branchHead: async () => 'headsha',
        workflowRuns: async () => [{ name: 'CI', status: 'completed', conclusion: 'success' }],
        promote,
        log: () => {},
      });
      expect(outcomes).toEqual([{ projectKey: 'overdeck', generation: windowBatch.name, action: 'promoted' }]);
      expect(promote).toHaveBeenCalledTimes(1);
      expect(promote).not.toHaveBeenCalledWith(uatBatch.name);
    } finally {
      vi.useRealTimers();
    }
  });
});
