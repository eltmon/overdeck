import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  __resetConflictGateProbeCacheForTests,
  buildRealConflictGateDeps,
  checkBranchMergeability,
  resolveConflictGate,
  type ExecRunner,
  type ResolveConflictGateDeps,
} from '../../../../src/lib/cloister/conflict-gate.js';
import type { BlockerReason, ReviewStatus } from '../../../../src/lib/review-status.js';

function makeRunner(results: Array<{ stdout?: string; stderr?: string } | Error>): ExecRunner {
  return vi.fn(async () => {
    const next = results.shift();
    if (!next) return { stdout: '', stderr: '' };
    if (next instanceof Error) throw next;
    return { stdout: next.stdout ?? '', stderr: next.stderr ?? '' };
  });
}

function commandError(message: string, fields: { code?: number; stdout?: string; stderr?: string } = {}): Error {
  return Object.assign(new Error(message), fields);
}

const mergeBlocker: BlockerReason = {
  type: 'merge_conflict',
  summary: 'Branch has conflicts',
  detectedAt: '2026-06-11T08:00:00.000Z',
};

const nonMergeBlocker: BlockerReason = {
  type: 'failing_checks',
  summary: 'CI failed',
  detectedAt: '2026-06-11T08:00:00.000Z',
};

function makeStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-1765',
    reviewStatus: 'pending',
    testStatus: 'pending',
    updatedAt: '2026-06-11T08:00:00.000Z',
    readyForMerge: false,
    ...overrides,
  };
}

function makeGateDeps(status: ReviewStatus | null, mergeability: 'clean' | 'conflicts' | 'unknown'): ResolveConflictGateDeps & {
  probeMergeability: ReturnType<typeof vi.fn>;
  dispatchResolver: ReturnType<typeof vi.fn>;
  setReviewStatus: ReturnType<typeof vi.fn>;
} {
  return {
    getReviewStatus: () => status,
    setReviewStatus: vi.fn((_issueId: string, update: Partial<ReviewStatus>) => {
      if (status) Object.assign(status, update);
      return status ?? makeStatus(update);
    }),
    probeMergeability: vi.fn(() => mergeability),
    dispatchResolver: vi.fn(() => {
      if (status) status.conflictResolutionDispatchedAt = new Date().toISOString();
      return 'dispatched';
    }),
    now: () => new Date(),
  };
}

describe('checkBranchMergeability', () => {
  it('returns clean when merge-tree reports a writable tree', async () => {
    const exec = makeRunner([{ stdout: '' }, { stdout: 'tree-hash\n' }]);

    await expect(checkBranchMergeability('/workspace', 'main', { exec })).resolves.toBe('clean');

    expect(exec).toHaveBeenNthCalledWith(
      1,
      'git fetch origin main',
      expect.objectContaining({ cwd: '/workspace', timeout: 30_000 }),
    );
    expect(exec).toHaveBeenNthCalledWith(
      2,
      'git merge-tree --write-tree --name-only HEAD origin/main',
      expect.objectContaining({ cwd: '/workspace', timeout: 30_000 }),
    );
  });

  it('returns conflicts when merge-tree reports conflicts', async () => {
    const exec = makeRunner([
      { stdout: '' },
      commandError('merge-tree failed', {
        code: 1,
        stdout: 'CONFLICT (content): Merge conflict in src/lib/example.ts\n',
      }),
    ]);

    await expect(checkBranchMergeability('/workspace', 'main', { exec })).resolves.toBe('conflicts');
  });

  it('returns unknown when fetch fails', async () => {
    const exec = makeRunner([commandError('network failed', { code: 128, stderr: 'fatal: unable to access origin' })]);

    await expect(checkBranchMergeability('/workspace', 'main', { exec })).resolves.toBe('unknown');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('returns unknown when merge-tree fails for a non-conflict reason', async () => {
    const exec = makeRunner([
      { stdout: '' },
      commandError('old git', { code: 129, stderr: 'usage: git merge-tree [--write-tree]' }),
    ]);

    await expect(checkBranchMergeability('/workspace', 'main', { exec })).resolves.toBe('unknown');
  });

  it('uses only fetch and merge-tree commands', async () => {
    const exec = makeRunner([{ stdout: '' }, { stdout: 'tree-hash\n' }]);

    await checkBranchMergeability('/workspace', 'main', { exec });

    const commands = vi.mocked(exec).mock.calls.map(([command]) => command);
    expect(commands).toEqual([
      'git fetch origin main',
      'git merge-tree --write-tree --name-only HEAD origin/main',
    ]);
    expect(commands.join('\n')).not.toContain('git merge ');
  });
});

describe('resolveConflictGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T08:30:00.000Z'));
    __resetConflictGateProbeCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetConflictGateProbeCacheForTests();
  });

  it('does not gate or probe statuses without merge blockers', async () => {
    const status = makeStatus({ blockerReasons: [nonMergeBlocker] });
    const deps = makeGateDeps(status, 'conflicts');

    await expect(resolveConflictGate('PAN-1765', '/workspace', 'main', deps)).resolves.toEqual({ gated: false });

    expect(deps.probeMergeability).not.toHaveBeenCalled();
    expect(deps.dispatchResolver).not.toHaveBeenCalled();
  });

  it('clears stale merge blockers when the branch now merges cleanly', async () => {
    const status = makeStatus({ blockerReasons: [mergeBlocker, nonMergeBlocker] });
    const deps = makeGateDeps(status, 'clean');

    await expect(resolveConflictGate('PAN-1765', '/workspace', 'main', deps)).resolves.toEqual({
      gated: false,
      clearedStaleBlocker: true,
    });

    expect(deps.setReviewStatus).toHaveBeenCalledWith(
      'PAN-1765',
      { blockerReasons: [nonMergeBlocker] },
      status,
    );
    expect(deps.dispatchResolver).not.toHaveBeenCalled();
  });

  it('gates and dispatches a resolver once for a real conflict within the throttle window', async () => {
    const status = makeStatus({ blockerReasons: [mergeBlocker] });
    const deps = makeGateDeps(status, 'conflicts');

    await expect(resolveConflictGate('PAN-1765', '/workspace', 'main', deps)).resolves.toMatchObject({
      gated: true,
      reason: expect.stringContaining('conflict resolver dispatched'),
      resolverDispatchState: 'dispatched',
    });
    await expect(resolveConflictGate('PAN-1765', '/workspace', 'main', deps)).resolves.toMatchObject({
      gated: true,
      reason: expect.stringContaining('dispatch throttled'),
      resolverDispatchState: 'throttled',
    });

    expect(deps.dispatchResolver).toHaveBeenCalledTimes(1);
  });
  it('does not let an old dispatch timestamp throttle a newer blocker instance', async () => {
    const status = makeStatus({
      blockerReasons: [{ ...mergeBlocker, detectedAt: '2026-06-11T08:20:00.000Z' }],
      conflictResolutionDispatchedAt: '2026-06-11T08:10:00.000Z',
    });
    const deps = makeGateDeps(status, 'conflicts');

    await expect(resolveConflictGate('PAN-1765', '/workspace', 'main', deps)).resolves.toMatchObject({
      gated: true,
      resolverDispatchState: 'dispatched',
    });

    expect(deps.dispatchResolver).toHaveBeenCalledTimes(1);
  });


  it('gates unknown probe results without throwing and still dispatches', async () => {
    const status = makeStatus({ blockerReasons: [mergeBlocker] });
    const deps = makeGateDeps(status, 'unknown');

    await expect(resolveConflictGate('PAN-1765', '/workspace', 'main', deps)).resolves.toMatchObject({
      gated: true,
      reason: expect.stringContaining('could not be verified'),
      resolverDispatchState: 'dispatched',
    });

    expect(deps.dispatchResolver).toHaveBeenCalledTimes(1);
  });

  it('caches probe results per issue for about three minutes', async () => {
    const status = makeStatus({ blockerReasons: [mergeBlocker] });
    const deps = makeGateDeps(status, 'conflicts');

    await resolveConflictGate('PAN-1765', '/workspace', 'main', deps);
    vi.advanceTimersByTime(2 * 60 * 1000);
    await resolveConflictGate('PAN-1765', '/workspace', 'main', deps);
    vi.advanceTimersByTime(61 * 1000);
    await resolveConflictGate('PAN-1765', '/workspace', 'main', deps);

    expect(deps.probeMergeability).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent probe calls for the same issue', async () => {
    const status = makeStatus({ blockerReasons: [mergeBlocker] });
    let callCount = 0;
    const deps = makeGateDeps(status, 'conflicts');
    deps.probeMergeability.mockImplementation(async () => {
      callCount += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      return 'conflicts';
    });

    const promiseA = resolveConflictGate('PAN-1765', '/workspace', 'main', deps);
    const promiseB = resolveConflictGate('PAN-1765', '/workspace', 'main', deps);
    await vi.advanceTimersByTimeAsync(1000);
    const [a, b] = await Promise.all([promiseA, promiseB]);

    expect(a.gated).toBe(true);
    expect(b.gated).toBe(true);
    expect(callCount).toBe(1);
    expect(deps.probeMergeability).toHaveBeenCalledTimes(1);
  });

  it('caps the probe cache at 256 entries and evicts oldest first', async () => {
    const baseStatus = makeStatus({ blockerReasons: [mergeBlocker] });
    let counter = 0;

    for (let i = 0; i < 260; i += 1) {
      const status = { ...baseStatus, issueId: `PAN-${1000 + i}` };
      const deps = makeGateDeps(status, 'conflicts');
      deps.probeMergeability.mockImplementation(async () => {
        counter += 1;
        return 'conflicts';
      });
      await resolveConflictGate(`PAN-${1000 + i}`, '/workspace', 'main', deps);
    }

    // 260 probes were issued, but cache retains only the last 256.
    expect(counter).toBe(260);

    // Re-probe the oldest issue: cache miss means a new probe.
    const oldestStatus = { ...baseStatus, issueId: 'PAN-1000' };
    const oldestDeps = makeGateDeps(oldestStatus, 'conflicts');
    let oldestReprobed = false;
    oldestDeps.probeMergeability.mockImplementation(async () => {
      oldestReprobed = true;
      return 'conflicts';
    });
    await resolveConflictGate('PAN-1000', '/workspace', 'main', oldestDeps);
    expect(oldestReprobed).toBe(true);

    // Re-probe the most recent issue within the cache window: cache hit.
    const newestStatus = { ...baseStatus, issueId: 'PAN-1259' };
    const newestDeps = makeGateDeps(newestStatus, 'conflicts');
    let newestReprobed = false;
    newestDeps.probeMergeability.mockImplementation(async () => {
      newestReprobed = true;
      return 'conflicts';
    });
    await resolveConflictGate('PAN-1259', '/workspace', 'main', newestDeps);
    expect(newestReprobed).toBe(false);
  });
});

describe('buildRealConflictGateDeps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T08:45:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches a work-role resolver with rebase and review-request instructions', async () => {
    const spawnRun = vi.fn(async () => ({} as never));
    const setReviewStatus = vi.fn();
    const emitActivityEntry = vi.fn();
    const deps = buildRealConflictGateDeps({
      spawnRun,
      setReviewStatus,
      emitActivityEntry,
      getReviewStatus: () => makeStatus({ blockerReasons: [mergeBlocker] }),
    });

    await deps.dispatchResolver({
      issueId: 'PAN-1765',
      workspacePath: '/workspace',
      targetBranch: 'main',
      blockerReasons: [mergeBlocker],
      reason: 'merge conflict with main must be resolved before review dispatch',
    });

    expect(spawnRun).toHaveBeenCalledWith('PAN-1765', 'work', {
      prompt: expect.stringContaining('Rebase this branch onto origin/main'),
    });
    const prompt = spawnRun.mock.calls[0][2].prompt;
    expect(prompt).toContain('BOTH intents are preserved');
    expect(prompt).toContain('Re-request review');
    expect(prompt).toContain('pan done or pan review request');
    expect(prompt).not.toContain('--force-with-lease');
    expect(setReviewStatus).toHaveBeenCalledWith(
      'PAN-1765',
      { conflictResolutionDispatchedAt: '2026-06-11T08:45:00.000Z' },
      expect.objectContaining({ issueId: 'PAN-1765' }),
    );
    expect(emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'review',
      message: 'Review deferred — conflict resolver dispatched for PAN-1765',
    }));
  });

  it('delivers the resolver prompt and stamps status when the work agent is already running', async () => {
    const spawnRun = vi.fn(async () => {
      throw new Error("Role run agent already running. Use 'pan tell' to message it.");
    });
    const messageAgent = vi.fn().mockResolvedValue(undefined);
    const setReviewStatus = vi.fn();
    const emitActivityEntry = vi.fn();
    const deps = buildRealConflictGateDeps({
      spawnRun,
      messageAgent,
      setReviewStatus,
      emitActivityEntry,
      getReviewStatus: () => makeStatus({ blockerReasons: [mergeBlocker] }),
    });

    await expect(deps.dispatchResolver({
      issueId: 'PAN-1765',
      workspacePath: '/workspace',
      targetBranch: 'main',
      blockerReasons: [mergeBlocker],
      reason: 'merge conflict with main must be resolved before review dispatch',
    })).resolves.toBe('already_running');

    expect(messageAgent).toHaveBeenCalledWith(
      'agent-pan-1765',
      expect.stringContaining('Rebase this branch onto origin/main'),
      'conflict-gate',
    );
    expect(setReviewStatus).toHaveBeenCalledWith(
      'PAN-1765',
      { conflictResolutionDispatchedAt: '2026-06-11T08:45:00.000Z' },
      expect.objectContaining({ issueId: 'PAN-1765' }),
    );
    expect(emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'review',
      message: expect.stringContaining('already running'),
    }));
  });
});
