import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProjectConfig } from '../../../../src/lib/projects.js';

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/projects.js')>();
  return {
    ...actual,
    loadProjectsConfigSync: () => ({
      projects: {
        pan: { name: 'Overdeck', path: '/projects/pan', issue_prefix: 'PAN', github_repo: 'eltmon/overdeck' } as ProjectConfig,
        // PAN-3154 cycle-2 finding: a GitLab-only project (no github_repo) must
        // still reach the sweep — canonical membership handles the tracker/forge
        // path, listProjects must not gate on github_repo.
        myn: { name: 'Mind Your Now', path: '/projects/myn', issue_prefix: 'MYN', gitlab_repo: 'group/myn' } as ProjectConfig,
      },
    }),
  };
});

import {
  __resetBranchInvalidationCooldownsForTests,
  buildRealBranchInvalidationDeps,
  reconcileBranchInvalidation,
  type ProjectDescriptor,
  type ReconcileBranchInvalidationDeps,
} from '../../../../src/lib/cloister/branch-invalidation.js';
import type { BlockerReason, ReviewStatus } from '../../../../src/lib/review-status.js';
import type { PipelineMembership } from '../../../../src/lib/pipeline-membership.js';

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

function makeProject(projectKey = 'pan', projectPath = '/projects/pan'): ProjectDescriptor {
  return {
    projectKey,
    projectPath,
    projectConfig: {
      name: 'Overdeck',
      path: projectPath,
      issue_prefix: projectKey.toUpperCase(),
      github_repo: 'eltmon/overdeck',
    } as ProjectConfig,
  };
}

function makeMembership(issueId: string, inPipeline = true): PipelineMembership {
  return {
    issueId,
    inPipeline,
    bucket: inPipeline ? 'in_flight' : 'clean_terminal',
    reasons: ['test fixture'],
    labelDrift: null,
    lenses: { L1_openPr: inPipeline, L2_unmergedBranch: false, L3_issueOpen: true, L4_phaseLabel: null },
  };
}

const OLD_SHA = 'oldshaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEW_SHA = 'shaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeDeps(overrides: Partial<ReconcileBranchInvalidationDeps> = {}): ReconcileBranchInvalidationDeps & {
  listProjects: ReturnType<typeof vi.fn>;
  gatherPipelineMembership: ReturnType<typeof vi.fn>;
  getReviewStatus: ReturnType<typeof vi.fn>;
  setReviewStatus: ReturnType<typeof vi.fn>;
  emitActivityEntry: ReturnType<typeof vi.fn>;
  getSetting: ReturnType<typeof vi.fn>;
  setSetting: ReturnType<typeof vi.fn>;
  probeConflictPaths: ReturnType<typeof vi.fn>;
  lsRemoteMainSha: ReturnType<typeof vi.fn>;
  resolveFeedbackTarget: ReturnType<typeof vi.fn>;
  messageAgent: ReturnType<typeof vi.fn>;
} {
  const settings = new Map<string, string>([['branch_invalidation.main_head.pan', OLD_SHA]]);
  return {
    listProjects: vi.fn(() => [makeProject()]),
    gatherPipelineMembership: vi.fn(async () => [makeMembership('PAN-1111')]),
    listAgentWorkspaces: () => [],
    existsSync: () => false,
    readdirSync: () => [],
    getSetting: vi.fn((key: string) => settings.get(key) ?? null),
    setSetting: vi.fn((key: string, value: string) => { settings.set(key, value); }),
    getReviewStatus: vi.fn((issueId: string) => makeStatus({ issueId })),
    setReviewStatus: vi.fn((_issueId: string, update: Partial<ReviewStatus>, existing?: ReviewStatus) => ({
      ...(existing ?? makeStatus()),
      ...update,
    } as ReviewStatus)),
    emitActivityEntry: vi.fn(),
    lsRemoteMainSha: vi.fn(async () => NEW_SHA),
    probeConflictPaths: vi.fn(async () => ({ mergeability: 'clean' as const, paths: [] })),
    resolveFeedbackTarget: vi.fn(async () => ({ agentId: 'agent-pan-1111' })),
    messageAgent: vi.fn(async () => undefined),
    now: () => Date.parse('2026-07-26T19:10:00.000Z'),
    ...overrides,
  };
}

describe('reconcileBranchInvalidation', () => {
  beforeEach(() => {
    __resetBranchInvalidationCooldownsForTests();
  });

  it('skips workspace probing when the stored main head is unchanged', async () => {
    const deps = makeDeps({ getSetting: vi.fn(() => NEW_SHA) });

    const actions = await reconcileBranchInvalidation(deps);

    expect(actions).toEqual([]);
    expect(deps.gatherPipelineMembership).not.toHaveBeenCalled();
    expect(deps.probeConflictPaths).not.toHaveBeenCalled();
    expect(deps.setReviewStatus).not.toHaveBeenCalled();
  });

  it('establishes the baseline without probing on the first observation (no prior SHA stored)', async () => {
    const deps = makeDeps({ getSetting: vi.fn(() => null) });

    const actions = await reconcileBranchInvalidation(deps);

    expect(deps.setSetting).toHaveBeenCalledWith('branch_invalidation.main_head.pan', NEW_SHA);
    expect(deps.gatherPipelineMembership).not.toHaveBeenCalled();
    expect(deps.probeConflictPaths).not.toHaveBeenCalled();
    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(deps.emitActivityEntry).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('probes normally once a baseline exists and the head changes again', async () => {
    const settings = new Map<string, string>();
    const deps = makeDeps({
      getSetting: vi.fn((key: string) => settings.get(key) ?? null),
      setSetting: vi.fn((key: string, value: string) => { settings.set(key, value); }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
    });

    await reconcileBranchInvalidation(deps); // first observation: baseline only
    expect(deps.probeConflictPaths).not.toHaveBeenCalled();

    __resetBranchInvalidationCooldownsForTests();
    deps.lsRemoteMainSha.mockResolvedValueOnce('nextshaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    await reconcileBranchInvalidation(deps);

    expect(deps.gatherPipelineMembership).toHaveBeenCalledTimes(1);
    expect(deps.probeConflictPaths).toHaveBeenCalledTimes(1);
  });

  it('probes every issue the canonical pipeline-membership resolver marks inPipeline, excluding clean_terminal issues', async () => {
    const deps = makeDeps({
      gatherPipelineMembership: vi.fn(async () => [
        makeMembership('PAN-1111', true),
        makeMembership('PAN-9999', false),
      ]),
      listAgentWorkspaces: () => [
        { issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' },
        { issueId: 'PAN-9999', workspace: '/projects/pan/workspaces/feature-pan-9999' },
      ],
      existsSync: () => true,
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.probeConflictPaths).toHaveBeenCalledTimes(1);
    expect(deps.probeConflictPaths).toHaveBeenCalledWith('/projects/pan/workspaces/feature-pan-1111', 'main');
  });

  it('skips the project sweep without advancing the stored SHA when canonical membership gathering fails', async () => {
    const deps = makeDeps({
      gatherPipelineMembership: vi.fn(async () => { throw new Error('forge unavailable'); }),
    });

    const actions = await reconcileBranchInvalidation(deps);

    expect(deps.probeConflictPaths).not.toHaveBeenCalled();
    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(deps.setSetting).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('sweeps every project listProjects returns', async () => {
    const deps = makeDeps({
      listProjects: vi.fn(() => [makeProject('pan'), makeProject('other', '/projects/other')]),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.lsRemoteMainSha).toHaveBeenCalledWith('/projects/pan');
    expect(deps.lsRemoteMainSha).toHaveBeenCalledWith('/projects/other');
  });

  it('the production listProjects does not gate on github_repo — a GitLab-only project is still enumerated', () => {
    const projects = buildRealBranchInvalidationDeps().listProjects();

    expect(projects.map((p) => p.projectKey).sort()).toEqual(['myn', 'pan']);
    const myn = projects.find((p) => p.projectKey === 'myn');
    expect(myn).toBeDefined();
    expect(myn?.projectConfig.github_repo).toBeUndefined();
    expect((myn?.projectConfig as { gitlab_repo?: string }).gitlab_repo).toBe('group/myn');
  });

  it('marks a newly-conflicting issue with conflictsSince and a replaced merge_conflict blocker, preserving non-merge blockers', async () => {
    const freshStatus = makeStatus({ blockerReasons: [nonMergeBlocker], readyForMerge: true });
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt', 'b.txt'] })),
      getReviewStatus: vi.fn(() => freshStatus),
    });

    const actions = await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).toHaveBeenCalledWith(
      'PAN-1111',
      expect.objectContaining({
        conflictsSince: {
          sha: NEW_SHA,
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
      freshStatus,
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
    expect(deps.messageAgent).toHaveBeenCalledWith('agent-pan-1111', expect.stringContaining('a.txt, b.txt'), 'internal');
  });

  it('re-reads canonical status immediately before writing, so a concurrent update during the probe is preserved rather than overwritten by a stale snapshot', async () => {
    const staleStatus = makeStatus({ reviewNotes: 'stale', testStatus: 'pending' });
    const freshStatus = makeStatus({ reviewNotes: 'updated while probing', testStatus: 'passed' });
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
      // Simulates: by the time the code re-reads canonical state (after the
      // await-ing probe), another actor already wrote a newer status.
      getReviewStatus: vi.fn(() => freshStatus),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).toHaveBeenCalledWith('PAN-1111', expect.anything(), freshStatus);
    expect(deps.setReviewStatus).not.toHaveBeenCalledWith('PAN-1111', expect.anything(), staleStatus);
  });

  it('marks a canonically in-pipeline conflict even when no review-status row exists (cache loss/rebuild), and advances the checkpoint since it was handled', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
      getReviewStatus: vi.fn(() => null),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).toHaveBeenCalledWith(
      'PAN-1111',
      expect.objectContaining({ conflictsSince: expect.objectContaining({ sha: NEW_SHA }) }),
      undefined,
    );
    expect(deps.setSetting).toHaveBeenCalledWith('branch_invalidation.main_head.pan', NEW_SHA);
  });

  it('skips an issue that was merged concurrently while its workspace was being probed', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
      getReviewStatus: vi.fn(() => makeStatus({ mergeStatus: 'merged' })),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).not.toHaveBeenCalled();
  });

  it('does not re-mark an issue already conflicting at the same main head (dedup)', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
      getReviewStatus: vi.fn(() => makeStatus({
        conflictsSince: { sha: NEW_SHA, detectedAt: '2026-07-26T18:00:00.000Z', paths: ['a.txt'] },
      })),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).not.toHaveBeenCalled();
  });

  it('running the sweep twice against the same main head marks each issue exactly once', async () => {
    const settings = new Map<string, string>([['branch_invalidation.main_head.pan', OLD_SHA]]);
    let marked: ReviewStatus | null = null;
    const deps = makeDeps({
      getSetting: vi.fn((key: string) => settings.get(key) ?? null),
      setSetting: vi.fn((key: string, value: string) => { settings.set(key, value); }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
      getReviewStatus: vi.fn(() => marked ?? makeStatus()),
    });
    deps.setReviewStatus.mockImplementation((_issueId, update, existing) => {
      marked = { ...(existing ?? makeStatus()), ...update } as ReviewStatus;
      return marked;
    });

    await reconcileBranchInvalidation(deps);
    expect(deps.setReviewStatus).toHaveBeenCalledTimes(1);

    __resetBranchInvalidationCooldownsForTests();
    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).toHaveBeenCalledTimes(1);
  });

  it('produces zero writes and does not advance the stored SHA when the probe is unknown', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'unknown' as const, paths: [] })),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(deps.emitActivityEntry).not.toHaveBeenCalled();
    expect(deps.setSetting).not.toHaveBeenCalled();
  });

  it('does not advance the stored SHA when at least one issue in the project probes unknown, even if another was newly marked', async () => {
    const deps = makeDeps({
      gatherPipelineMembership: vi.fn(async () => [makeMembership('PAN-1111'), makeMembership('PAN-2222')]),
      listAgentWorkspaces: () => [
        { issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' },
        { issueId: 'PAN-2222', workspace: '/projects/pan/workspaces/feature-pan-2222' },
      ],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async (workspacePath: string) =>
        workspacePath.endsWith('1111')
          ? { mergeability: 'conflicts' as const, paths: ['a.txt'] }
          : { mergeability: 'unknown' as const, paths: [] },
      ),
      getReviewStatus: vi.fn((issueId: string) => makeStatus({ issueId })),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.setReviewStatus).toHaveBeenCalledTimes(1);
    expect(deps.setSetting).not.toHaveBeenCalled();
  });

  it('produces zero writes and keeps the last-seen SHA when ls-remote fails', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      lsRemoteMainSha: vi.fn(async () => null),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.gatherPipelineMembership).not.toHaveBeenCalled();
    expect(deps.probeConflictPaths).not.toHaveBeenCalled();
    expect(deps.setReviewStatus).not.toHaveBeenCalled();
    expect(deps.setSetting).not.toHaveBeenCalled();
  });

  it('resolves the workspace from the agents-table column when it exists, without scanning the workspaces directory', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111-strike' }],
      existsSync: (path: string) => path === '/projects/pan/workspaces/feature-pan-1111-strike',
      readdirSync: vi.fn(() => { throw new Error('should not scan the workspaces dir when the agents-table workspace exists'); }),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.probeConflictPaths).toHaveBeenCalledWith('/projects/pan/workspaces/feature-pan-1111-strike', 'main');
  });

  it('falls back to a feature-<issue>* prefix scan covering -strike/-slot-N dirs when no agents-table workspace exists', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [],
      existsSync: (path: string) => path === '/projects/pan/workspaces',
      readdirSync: () => ['feature-pan-1111-slot-2', 'feature-pan-1111', 'feature-pan-1111-strike', 'feature-pan-22222'],
    });

    await reconcileBranchInvalidation(deps);

    // Sorted lexically, the plain "feature-pan-1111" sorts before any suffixed variant.
    expect(deps.probeConflictPaths).toHaveBeenCalledWith('/projects/pan/workspaces/feature-pan-1111', 'main');
  });

  it('reads the agents-table workspace list and the workspaces directory listing at most once per project sweep', async () => {
    const listAgentWorkspaces = vi.fn(() => []);
    const readdirSync = vi.fn(() => ['feature-pan-1111', 'feature-pan-2222']);
    const deps = makeDeps({
      gatherPipelineMembership: vi.fn(async () => [makeMembership('PAN-1111'), makeMembership('PAN-2222')]),
      listAgentWorkspaces,
      existsSync: (path: string) => path === '/projects/pan/workspaces',
      readdirSync,
    });

    await reconcileBranchInvalidation(deps);

    expect(listAgentWorkspaces).toHaveBeenCalledTimes(1);
    expect(readdirSync).toHaveBeenCalledTimes(1);
  });

  it('skips an issue with no resolvable workspace', async () => {
    const deps = makeDeps({ listAgentWorkspaces: () => [], existsSync: () => false });

    const actions = await reconcileBranchInvalidation(deps);

    expect(deps.probeConflictPaths).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('sends no message and throws no error for a needsYou (no live agent) target, but still marks the issue', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
      resolveFeedbackTarget: vi.fn(async () => ({ needsYou: true, reason: 'no live agent' })),
    });

    await expect(reconcileBranchInvalidation(deps)).resolves.toEqual(expect.any(Array));

    expect(deps.messageAgent).not.toHaveBeenCalled();
    expect(deps.setReviewStatus).toHaveBeenCalledWith(
      'PAN-1111',
      expect.objectContaining({ conflictsSince: expect.objectContaining({ sha: NEW_SHA }) }),
      expect.anything(),
    );
  });

  it('delivers exactly one notification per main-head SHA to a live agent, naming the sha and every path', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt', 'b.txt', 'c.txt'] })),
      resolveFeedbackTarget: vi.fn(async () => ({ agentId: 'agent-pan-1111' })),
    });

    await reconcileBranchInvalidation(deps);

    expect(deps.messageAgent).toHaveBeenCalledTimes(1);
    const [agentId, message] = deps.messageAgent.mock.calls[0];
    expect(agentId).toBe('agent-pan-1111');
    expect(message).toContain('shaaaaa');
    expect(message).toContain('a.txt');
    expect(message).toContain('b.txt');
    expect(message).toContain('c.txt');
  });

  it('does not advertise a direct git rebase fallback the pre-rebase guard would reject', async () => {
    const deps = makeDeps({
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
    });

    await reconcileBranchInvalidation(deps);

    const [, message] = deps.messageAgent.mock.calls[0];
    expect(message).toContain('pan sync-main PAN-1111');
    expect(message).not.toContain('git rebase');
  });

  it('sends no additional message on a second sweep with an unchanged main head', async () => {
    const settings = new Map<string, string>([['branch_invalidation.main_head.pan', OLD_SHA]]);
    let marked: ReviewStatus | null = null;
    const deps = makeDeps({
      getSetting: vi.fn((key: string) => settings.get(key) ?? null),
      setSetting: vi.fn((key: string, value: string) => { settings.set(key, value); }),
      listAgentWorkspaces: () => [{ issueId: 'PAN-1111', workspace: '/projects/pan/workspaces/feature-pan-1111' }],
      existsSync: () => true,
      probeConflictPaths: vi.fn(async () => ({ mergeability: 'conflicts' as const, paths: ['a.txt'] })),
      getReviewStatus: vi.fn(() => marked ?? makeStatus()),
    });
    deps.setReviewStatus.mockImplementation((_issueId, update, existing) => {
      marked = { ...(existing ?? makeStatus()), ...update } as ReviewStatus;
      return marked;
    });

    await reconcileBranchInvalidation(deps);
    expect(deps.messageAgent).toHaveBeenCalledTimes(1);

    __resetBranchInvalidationCooldownsForTests();
    await reconcileBranchInvalidation(deps);

    expect(deps.messageAgent).toHaveBeenCalledTimes(1);
  });
});
