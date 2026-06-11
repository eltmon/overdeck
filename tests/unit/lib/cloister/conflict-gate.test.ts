import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  __resetConflictGateProbeCacheForTests,
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

    await expect(resolveConflictGate('PAN-1765', '/workspace', 'main', deps)).resolves.toMatchObject({ gated: true });
    await expect(resolveConflictGate('PAN-1765', '/workspace', 'main', deps)).resolves.toMatchObject({ gated: true });

    expect(deps.dispatchResolver).toHaveBeenCalledTimes(1);
  });

  it('gates unknown probe results without throwing and still dispatches', async () => {
    const status = makeStatus({ blockerReasons: [mergeBlocker] });
    const deps = makeGateDeps(status, 'unknown');

    await expect(resolveConflictGate('PAN-1765', '/workspace', 'main', deps)).resolves.toMatchObject({
      gated: true,
      reason: expect.stringContaining('could not be verified'),
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
});
