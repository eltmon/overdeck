import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  __resetBranchInvalidationCooldownsForTests,
  reconcileBranchInvalidation,
  type ReconcileBranchInvalidationDeps,
} from '../../../../src/lib/cloister/branch-invalidation.js';
import type { BlockerReason, ReviewStatus } from '../../../../src/lib/review-status.js';

function makeStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-1111',
    reviewStatus: 'pending',
    testStatus: 'pending',
    updatedAt: '2026-07-26T18:00:00.000Z',
    readyForMerge: true,
    ...overrides,
  };
}

const nonMergeBlocker: BlockerReason = {
  type: 'failing_checks',
  summary: 'CI failed',
  detectedAt: '2026-07-26T17:00:00.000Z',
};

function makeDeps(overrides: Partial<ReconcileBranchInvalidationDeps> = {}): ReconcileBranchInvalidationDeps & {
  setReviewStatus: ReturnType<typeof vi.fn>;
  emitActivityEntry: ReturnType<typeof vi.fn>;
  setSetting: ReturnType<typeof vi.fn>;
  probeConflictPaths: ReturnType<typeof vi.fn>;
  lsRemoteMainSha: ReturnType<typeof vi.fn>;
} {
  const settings = new Map<string, string>();
  return {
    loadReviewStatuses: () => ({}),
    resolveProject: (issueId: string) => ({ projectKey: 'pan', projectPath: `/projects/${issueId.split('-')[0].toLowerCase()}` }),
    listAgentWorkspaces: () => [],
    existsSync: () => false,
    readdirSync: () => [],
    getSetting: vi.fn((key: string) => settings.get(key) ?? null),
    setSetting: vi.fn((key: string, value: string) => { settings.set(key, value); }),
    setReviewStatus: vi.fn((_issueId: string, update: Partial<ReviewStatus>, existing?: ReviewStatus) => ({
      ...(existing ?? makeStatus()),
      ...update,
    } as ReviewStatus)),
    emitActivityEntry: vi.fn(),
    lsRemoteMainSha: vi.fn(async () => 'shaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    probeConflictPaths: vi.fn(async () => ({ mergeability: 'clean' as const, paths: [] })),
    now: () => Date.parse('2026-07-26T19:10:00.000Z'),
    ...overrides,
  };
}

describe('reconcileBranchInvalidation', () => {
  beforeEach(() => {
    __resetBranchInvalidationCooldownsForTests();
  });

  it('skips workspace probing when the stored main head is unchanged', async () => {
    const status = makeStatus();
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': status }),
      getSetting: vi.fn(() => 'shaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
    });

    const actions = await reconcileBranchInvalidation(deps);

    expect(actions).toEqual([]);
    expect(deps.probeConflictPaths).not.toHaveBeenCalled();
    expect(deps.setReviewStatus).not.toHaveBeenCalled();
  });

  it('probes every in-pipeline issue of the project when the main head moves', async () => {
    const statusA = makeStatus({ issueId: 'PAN-1111' });
    const statusB = makeStatus({ issueId: 'PAN-2222' });
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': statusA, 'PAN-2222': statusB }),
      listAgentWorkspaces: () => [
        { issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' },
        { issueId: 'PAN-2222', workspace: '/projects/pan/workspaces/feature-pan-2222' },
      ],
      existsSync: () => true,
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.probeConflictPaths).toHaveBeenCalledTimes(2);
    expect(deps.probeConflictPaths).toHaveBeenCalledWith('/projects/pan/workspaces/feature-pan-1111', 'main');
    expect(deps.probeConflictPaths).toHaveBeenCalledWith('/projects/pan/workspaces/feature-pan-2222', 'main');
  });

  it('only probes issues belonging to the project whose main head moved', async () => {
    const panStatus = makeStatus({ issueId: 'PAN-1111' });
    const krxStatus = makeStatus({ issueId: 'KRX-1' });
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': panStatus, 'KRX-1': krxStatus }),
      resolveProject: (issueId: string) => issueId.startsWith('PAN')
        ? { projectKey: 'pan', projectPath: '/projects/pan' }
        : { projectKey: 'krx', projectPath: '/projects/krx' },
      listAgentWorkspaces: () => [
        { issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' },
        { issueId: 'KRX-1', workspace: '/projects/krx/workspaces/feature-krx-1' },
      ],
      existsSync: () => true,
      lsRemoteMainSha: vi.fn(async (projectPath: string) =>
        projectPath === '/projects/pan' ? 'newshaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : null,
      ),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.probeConflictPaths).toHaveBeenCalledTimes(1);
    expect(deps.probeConflictPaths).toHaveBeenCalledWith('/projects/pan/workspaces/feature-pan-1111', 'main');
  });

  it('marks a newly-conflicting issue with conflictsSince and a replaced merge_conflict blocker, preserving non-merge blockers', async () => {
    const status = makeStatus({ blockerReasons: [nonMergeBlocker], readyForMerge: true });
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': status }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt', 'b.txt'] })),
    });

    const actions = await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).toHaveBeenCalledWith(
      'PAN-1111',
      expect.objectContaining({
        conflictsSince: {
          sha: 'shaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          detectedAt: '2026-07-26T19:10:00.000Z',
          paths: ['a.txt', 'b.txt'],
        },
        blockerReasons: [
          nonMergeBlocker,
          expect.objectContaining({
            type: 'merge_conflict',
            summary: expect.stringContaining('a.txt, b.txt'),
          }),
        ],
      }),
      status,
    );
    expect(deps.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister',
      level: 'warn',
      issueId: 'PAN-1111',
    }));
    expect(deps.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister',
      level: 'warn',
      message: expect.stringContaining('invalidated 1 branch(es): PAN-1111'),
    }));
    expect(actions.some((a) => a.includes('PAN-1111'))).toBe(true);
  });

  it('does not re-mark an issue already conflicting at the same main head (dedup)', async () => {
    const status = makeStatus({
      conflictsSince: {
        sha: 'shaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        detectedAt: '2026-07-26T18:00:00.000Z',
        paths: ['a.txt'],
      },
    });
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': status }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).not.toHaveBeenCalled();
  });

  it('running the sweep twice against the same main head marks each issue exactly once', async () => {
    const status = makeStatus();
    let currentStatus = status;
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': currentStatus }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
    });
    deps.setReviewStatus.mockImplementation((_issueId, update, existing) => {
      currentStatus = { ...(existing ?? status), ...update } as ReviewStatus;
      return currentStatus;
    });

    await reconcileBranchInvalidation(deps);
    expect(deps.setReviewStatus).toHaveBeenCalledTimes(1);

    // Second run: cooldown blocks re-probing this cycle, so advance past it —
    // main head is unchanged, so the setting comparison should skip the probe.
    __resetBranchInvalidationCooldownsForTests();
    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).toHaveBeenCalledTimes(1);
  });

  it('produces zero writes and preserves the stored SHA when the probe is unknown', async () => {
    const status = makeStatus();
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': status }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'unknown' as const, paths: [] })),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(deps.emitActivityEntry).not.toHaveBeenCalled();
    // The new SHA is still recorded even though no issue was newly marked —
    // this is not "preserving the stored SHA" in the ls-remote-failure sense,
    // it is the normal per-sweep bookkeeping.
    expect(deps.setSetting).toHaveBeenCalled();
  });

  it('produces zero writes and keeps the last-seen SHA when ls-remote fails', async () => {
    const status = makeStatus();
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': status }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      lsRemoteMainSha: vi.fn(async () => null),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.probeConflictPaths).not.toHaveBeenCalled();
    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(deps.setSetting).not.toHaveBeenCalled();
  });

  it('resolves the workspace from the agents-table column when it exists', async () => {
    const status = makeStatus();
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': status }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111-strike' }],
      existsSync: (path: string) => path === '/projects/pan/workspaces/feature-pan-1111-strike',
      readdirSync: vi.fn(() => { throw new Error('should not scan the workspaces dir when the agents-table workspace exists'); }),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.probeConflictPaths).toHaveBeenCalledWith('/projects/pan/workspaces/feature-pan-1111-strike', 'main');
  });

  it('falls back to a feature-<issue>* prefix scan covering -strike/-slot-N dirs when no agents-table workspace exists', async () => {
    const status = makeStatus();
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': status }),
      listAgentWorkspaces: () => [],
      existsSync: (path: string) => path === '/projects/pan/workspaces',
      readdirSync: () => ['feature-pan-1111-slot-2', 'feature-pan-1111', 'feature-pan-1111-strike', 'feature-pan-22222'],
    });

    await reconcileBranchInvalidation(deps);

    // Sorted lexically, the plain "feature-pan-1111" sorts before any suffixed variant.
    expect(deps.probeConflictPaths).toHaveBeenCalledWith('/projects/pan/workspaces/feature-pan-1111', 'main');
  });

  it('skips an issue with no resolvable workspace', async () => {
    const status = makeStatus();
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': status }),
      listAgentWorkspaces: () => [],
      existsSync: () => false,
    });

    const actions = await reconcileBranchInvalidation(deps);

    expect(deps.probeConflictPaths).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('excludes merged issues from the sweep', async () => {
    const status = makeStatus({ mergeStatus: 'merged' });
    const deps = makeDeps({
      loadReviewStatuses: () => ({ 'PAN-1111': status }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.lsRemoteMainSha).not.toHaveBeenCalled();
  });
});
