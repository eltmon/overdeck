import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canStartUatTrainReconciler,
  getUatCandidatePayload,
  getUatGenerationsPayload,
  postUatGenerationPromotePayload,
  resolveUatProjectRoot,
  runUatTrainReconcile,
  startUatTrainReconciler,
  stopUatTrainReconciler,
} from '../uat-train.js';
import type { UatReconcilerDeps } from '../../../../lib/cloister/uat-reconciler.js';
import type { UatGeneration } from '../../../../lib/overdeck/merge-types.js';
import type { PromoteResult } from '../../../../lib/cloister/uat-promote.js';

const mocks = vi.hoisted(() => ({
  findProjectByPath: vi.fn(),
  getDashboardIdentity: vi.fn(),
  listUatGenerations: vi.fn(),
  probeUatStack: vi.fn(),
  teardownUatStack: vi.fn(),
  promoteUatGeneration: vi.fn(),
  buildUatPromoteGitDeps: vi.fn(),
  buildUatGenerationStore: vi.fn(),
  getUatGeneration: vi.fn(),
  findXBriefByIssue: vi.fn(),
  readXBriefDocument: vi.fn(),
  reviewRecordEligibility: vi.fn(),
  isMergeTrainEnabledForProject: vi.fn(),
  listReadyIssuesForProject: vi.fn(),
  reconcileUatGenerations: vi.fn(),
  assemblePolyrepoUatGeneration: vi.fn(),
  buildPolyrepoGitDeps: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  resolveProjectReposFromResolvedIssue: vi.fn(),
  hasUncleanedTerminalUatGeneration: vi.fn(),
  runAutoMergeSchedulerTick: vi.fn(),
}));

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...original,
    findProjectByPath: mocks.findProjectByPath,
    resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  };
});

vi.mock('../../../../lib/project-repos.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/project-repos.js')>();
  return {
    ...original,
    resolveProjectReposFromResolvedIssue: mocks.resolveProjectReposFromResolvedIssue,
  };
});

vi.mock('../../../../lib/cloister/uat-reconciler.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/cloister/uat-reconciler.js')>();
  return {
    ...original,
    reconcileUatGenerations: mocks.reconcileUatGenerations,
  };
});

vi.mock('../../../../lib/cloister/uat-polyrepo-engine.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/cloister/uat-polyrepo-engine.js')>();
  return {
    ...original,
    assemblePolyrepoUatGeneration: mocks.assemblePolyrepoUatGeneration,
  };
});

vi.mock('../../identity.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../identity.js')>();
  return {
    ...original,
    getDashboardIdentity: mocks.getDashboardIdentity,
  };
});

// uat-train.ts now imports listUatGenerations from overdeck/merge-sync (not database/uat-generations-db)
vi.mock('../../../../lib/overdeck/merge-sync.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/overdeck/merge-sync.js')>();
  return {
    ...original,
    getUatGeneration: mocks.getUatGeneration,
    listUatGenerations: mocks.listUatGenerations,
    isMergeTrainEnabledForProject: mocks.isMergeTrainEnabledForProject,
    hasUncleanedTerminalUatGeneration: mocks.hasUncleanedTerminalUatGeneration,
  };
});

vi.mock('../../../../lib/cloister/uat-stack.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/cloister/uat-stack.js')>();
  return {
    ...original,
    probeUatStack: mocks.probeUatStack,
    teardownUatStack: mocks.teardownUatStack,
  };
});

vi.mock('../../../../lib/cloister/uat-promote.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/cloister/uat-promote.js')>();
  return {
    ...original,
    promoteUatGeneration: mocks.promoteUatGeneration,
    buildUatPromoteGitDeps: mocks.buildUatPromoteGitDeps,
  };
});


// PAN-3917: the candidate list is the forge's — every open PR that is
// approved, green, and mergeable — not a record-backed eligibility scan.
vi.mock('../derived-issue-state.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../derived-issue-state.js')>();
  return {
    ...original,
    listReadyIssuesForProject: async () => mocks.listReadyIssuesForProject(),
  };
});

vi.mock('../../../../lib/flywheel-merge-order.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/flywheel-merge-order.js')>();
  return {
    ...original,
    reviewRecordEligibility: mocks.reviewRecordEligibility,
    listReadyIssuesForProject: mocks.listReadyIssuesForProject,
  };
});

vi.mock('../../../../lib/cloister/uat-generation-deps.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/cloister/uat-generation-deps.js')>();
  return {
    ...original,
    buildUatGenerationStore: mocks.buildUatGenerationStore,
    buildPolyrepoGitDeps: mocks.buildPolyrepoGitDeps,
  };
});

vi.mock('../../../../lib/xbrief/xbrief-index.js', () => ({
  findXBriefByIssue: mocks.findXBriefByIssue,
  readXBriefDocument: mocks.readXBriefDocument,
}));

function gen(members: UatGeneration['members']): UatGeneration {
  return {
    name: 'uat/pan-otter-0610',
    worktreePath: '/proj/workspaces/uat-pan-otter-0610',
    projectRoot: process.cwd(),
    baseSha: 'main-sha',
    status: 'ready',
    members,
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    cleanedAt: null,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
  };
}

function doc(title: string) {
  return {
    xBRIEFInfo: {},
    plan: {
      id: 'PAN-X',
      title: 'Plan',
      status: 'proposed',
      items: [{
        id: 'item',
        title: 'Item',
        status: 'pending',
        subItems: [{
          id: 'item.ac',
          title,
          status: 'pending',
          metadata: { kind: 'acceptance_criterion' },
        }],
      }],
    },
  };
}

describe('getUatGenerationsPayload', () => {
  let tmp: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectByPath.mockReturnValue(null);
    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: process.cwd(), mode: 'primary' });
    mocks.probeUatStack.mockResolvedValue({ status: 'absent', frontendUrl: 'https://uat-pan-otter-0610.overdeck.localhost' });
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  // PAN-3093: the payload gains per-repo detail additively so the follow-up
  // presentation work has data to render.
  it('projects per-repo generation detail onto the payload', async () => {
    const polyGen = {
      ...gen([]),
      repos: [
        {
          repoKey: 'fe', repoPath: '/repos/myn/fe', branch: 'uat/min-otter-0727',
          baseSha: 'aaa1111', targetBranch: 'main',
          worktreePath: '/repos/myn/workspaces/uat-min-otter-0727/fe',
          mergeOrder: 0, promotedAt: null, mergeSha: null,
        },
      ],
    } as UatGeneration;
    mocks.listUatGenerations.mockReturnValue([polyGen]);
    mocks.findXBriefByIssue.mockReturnValue(Effect.succeed(null));

    const payload = await getUatGenerationsPayload('/repos/myn');

    expect(payload[0]!.repos).toEqual([{
      repoKey: 'fe',
      branch: 'uat/min-otter-0727',
      baseSha: 'aaa1111',
      targetBranch: 'main',
      mergeOrder: 0,
      promotedAt: null,
      mergeSha: null,
    }]);
    // Absolute server paths must not leave the process.
    expect(JSON.stringify(payload[0]!.repos)).not.toContain('/repos/myn');
  });

  it('projects the synthesized single repo for a monorepo generation', async () => {
    // The store always yields at least one entry, so the payload shape is the
    // same whether or not the project is polyrepo.
    const monoGen = {
      ...gen([]),
      repos: [{
        repoKey: 'overdeck', repoPath: '/proj', branch: 'uat/pan-otter-0610',
        baseSha: 'main-sha', targetBranch: 'main',
        worktreePath: '/proj/workspaces/uat-pan-otter-0610',
        mergeOrder: 0, promotedAt: null, mergeSha: null,
      }],
    } as UatGeneration;
    mocks.listUatGenerations.mockReturnValue([monoGen]);
    mocks.findXBriefByIssue.mockReturnValue(Effect.succeed(null));

    const payload = await getUatGenerationsPayload('/repos/myn');

    expect(payload[0]!.repos).toHaveLength(1);
    expect(payload[0]!.repos[0]!.repoKey).toBe('overdeck');
  });

  // PAN-1696 review finding: once this payload started serving every tracked
  // project, resolving each member's xBRIEF against the DASHBOARD's repo left
  // every non-PAN batch with an empty "What to UAT" checklist.
  it("resolves acceptance criteria in the generation's own project, not the dashboard's", async () => {
    mocks.listUatGenerations.mockReturnValue([
      gen([{ issueId: 'MIN-831', title: 'Compass', branch: 'feature/min-831', headSha: 'h1', mergeOrder: 1 }]),
    ]);
    mocks.findXBriefByIssue.mockReturnValue(Effect.succeed(null));

    await getUatGenerationsPayload('/repos/myn');

    // The lookup root must be the MYN repo the caller asked for.
    expect(mocks.findXBriefByIssue).toHaveBeenCalledWith('/repos/myn', 'MIN-831');
    expect(mocks.listUatGenerations).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/repos/myn' }),
    );
  });

  // PAN-3165: an unresolvable spec must not be reported as a plan that listed
  // no criteria — the UAT panel renders that as a factual claim and deletes the
  // operator's checklist.
  it('marks a member whose spec cannot be resolved as planResolved: false', async () => {
    mocks.listUatGenerations.mockReturnValue([
      gen([{ issueId: 'PAN-3158', title: 'Cedar', branch: 'feature/pan-3158', headSha: 'h1', mergeOrder: 1 }]),
    ]);
    mocks.findXBriefByIssue.mockReturnValue(Effect.succeed(null));

    const payload = await getUatGenerationsPayload('/repos/myn');

    expect(payload[0]!.members[0]!.planResolved).toBe(false);
    expect(payload[0]!.members[0]!.acceptanceCriteria).toEqual([]);
  });

  it('marks a member whose spec resolves as planResolved: true', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pan-uat-train-'));
    const specPath = join(tmp, 'PAN-3158.xbrief.json');
    await writeFile(specPath, '{}');
    mocks.listUatGenerations.mockReturnValue([
      gen([{ issueId: 'PAN-3158', title: 'Cedar', branch: 'feature/pan-3158', headSha: 'h1', mergeOrder: 1 }]),
    ]);
    mocks.findXBriefByIssue.mockReturnValue(Effect.succeed({
      path: specPath,
      lifecycleDir: 'proposed',
      issueId: 'PAN-3158',
      slug: 'cedar',
      date: '2026-07-26',
      filename: 'PAN-3158.xbrief.json',
    }));
    mocks.readXBriefDocument.mockReturnValue(Effect.succeed(doc('Given a member, when read, then 14 criteria') as never));

    const payload = await getUatGenerationsPayload('/repos/myn');

    expect(payload[0]!.members[0]!.planResolved).toBe(true);
    expect(payload[0]!.members[0]!.acceptanceCriteria).toEqual([
      { title: 'Given a member, when read, then 14 criteria', status: 'pending' },
    ]);
  });

  it('returns generations without flywheel run active (PAN-1696: reconciler-decouple.ac4)', async () => {
    // With reconciler-decouple, generations are visible regardless of flywheel run state
    const generation = gen([
      { issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 },
    ]);
    mocks.listUatGenerations.mockReturnValue([generation]);
    // For a ready generation, probeUatStack succeeds; AC items get cached empty list
    mocks.probeUatStack.mockResolvedValue({ status: 'running', frontendUrl: 'http://test' });

    const result = await getUatGenerationsPayload();

    // Should return the generation even without a flywheel run
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe(generation.name);
    expect(mocks.listUatGenerations).toHaveBeenCalled();
  });

  it('bounds member xBRIEF reads and reuses unchanged checklist summaries', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pan-uat-train-'));
    const pathByIssue = new Map<string, string>();
    const members = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const issueId = `PAN-${index + 1}`;
      const path = join(tmp!, `${issueId}.xbrief.json`);
      await writeFile(path, '{}');
      pathByIssue.set(issueId, path);
      return { issueId, title: issueId, branch: `feature/pan-${index + 1}`, headSha: `h${index + 1}`, mergeOrder: index + 1 };
    }));
    let activeReads = 0;
    let maxActiveReads = 0;

    mocks.listUatGenerations.mockReturnValue([gen(members)]);
    mocks.findXBriefByIssue.mockImplementation((_root: string, issueId: string) => Effect.succeed({
      path: pathByIssue.get(issueId)!,
      lifecycleDir: 'proposed',
      issueId,
      slug: issueId.toLowerCase(),
      date: '2026-06-10',
      filename: `${issueId}.xbrief.json`,
    }));
    mocks.readXBriefDocument.mockImplementation((path: string) => Effect.promise(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeReads -= 1;
      return doc(`AC for ${path}`) as never;
    }));

    const first = await getUatGenerationsPayload();
    const second = await getUatGenerationsPayload();

    expect(first[0]!.members).toHaveLength(8);
    expect(second[0]!.members[0]!.acceptanceCriteria).toEqual(first[0]!.members[0]!.acceptanceCriteria);
    expect(maxActiveReads).toBeLessThanOrEqual(4);
    expect(mocks.findXBriefByIssue).toHaveBeenCalledTimes(8);
    expect(mocks.readXBriefDocument).toHaveBeenCalledTimes(8);
  });
});

describe('getUatCandidatePayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectByPath.mockReturnValue(null);
    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: process.cwd(), mode: 'primary' });
  });

  it('returns the newest ready generation as the active UAT candidate', async () => {
    mocks.listUatGenerations.mockReturnValue([gen([
      { issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Two', branch: 'feature/pan-2', headSha: 'h2', mergeOrder: 2 },
    ])]);

    await expect(getUatCandidatePayload()).resolves.toEqual({
      branchName: 'uat/pan-otter-0610',
      bundled: ['PAN-1', 'PAN-2'],
      status: 'ready',
    });
    expect(mocks.listUatGenerations).toHaveBeenCalledWith({
      projectRoot: resolveUatProjectRoot(),
      statuses: ['ready'],
      limit: 1,
    });
  });

  it('returns null when no ready UAT candidate exists', async () => {
    mocks.listUatGenerations.mockReturnValue([]);

    await expect(getUatCandidatePayload()).resolves.toBeNull();
  });
});

describe('UAT train project root and startup gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectByPath.mockReturnValue(null);
  });

  it('resolves feature workspace cwd back to the project root', () => {
    expect(resolveUatProjectRoot('/repo/workspaces/feature-pan-2148')).toBe('/repo');
    expect(resolveUatProjectRoot('/repo/workspaces/feature-pan-2148/workspaces/uat-pan-cobalt-0703')).toBe('/repo');
  });

  it('prefers the registered project root when the registry matches the cwd', () => {
    mocks.findProjectByPath.mockReturnValue({ path: '/registered/repo' });

    expect(resolveUatProjectRoot('/registered/repo/workspaces/feature-pan-2148')).toBe('/registered/repo');
  });

  it('lets only the primary dashboard process start the UAT reconciler', () => {
    mocks.findProjectByPath.mockReturnValue({ path: '/repo' });

    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: '/repo', mode: 'primary' });
    expect(canStartUatTrainReconciler()).toBe(true);

    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: '/repo/workspaces/feature-pan-2148', mode: 'primary' });
    expect(canStartUatTrainReconciler()).toBe(false);

    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: '/repo', mode: 'peer' });
    expect(canStartUatTrainReconciler()).toBe(false);
  });

  it('runs its tick hook at start and on every reconciler tick (#3983)', async () => {
    vi.useFakeTimers();
    try {
      mocks.findProjectByPath.mockReturnValue({ path: '/repo' });
      mocks.getDashboardIdentity.mockReturnValue({ repoRoot: '/repo', mode: 'primary' });
      mocks.runAutoMergeSchedulerTick.mockResolvedValue([]);

      expect(startUatTrainReconciler({ onTick: mocks.runAutoMergeSchedulerTick })).toBe(true);
      expect(mocks.runAutoMergeSchedulerTick).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.runAutoMergeSchedulerTick).toHaveBeenCalledTimes(2);
    } finally {
      stopUatTrainReconciler();
      vi.useRealTimers();
    }
  });

  it('runs no tick hook from a peer dashboard (#3983)', () => {
    mocks.findProjectByPath.mockReturnValue({ path: '/repo' });
    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: '/repo', mode: 'peer' });

    expect(startUatTrainReconciler({ onTick: mocks.runAutoMergeSchedulerTick })).toBe(false);
    expect(mocks.runAutoMergeSchedulerTick).not.toHaveBeenCalled();
  });
});

describe('postUatGenerationPromotePayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectByPath.mockReturnValue(null);
    mocks.buildUatPromoteGitDeps.mockReturnValue({ git: 'deps' });
    mocks.buildUatGenerationStore.mockReturnValue({ listChain: vi.fn(), update: vi.fn() });
  });

  // PAN-3917: promotion used to stamp a verification verdict onto every
  // member's record. The merge is the evidence — the generation row carries the
  // merge sha and readiness is re-derived from each PR — so there is no
  // recordVerification dependency left to wire.

  it('returns the exact promote result object unchanged for success and failure results', async () => {
    const success: PromoteResult = {
      success: true,
      generation: 'uat/pan-cobalt-0703',
      mergeSha: 'abc123',
      members: ['PAN-2294'],
      postMergeStarted: ['PAN-2294'],
      invalidated: [],
    };
    const failure: PromoteResult = {
      success: false,
      reason: 'member-not-ready',
      message: 'not ready',
    };

    mocks.promoteUatGeneration.mockResolvedValueOnce(success).mockResolvedValueOnce(failure);

    await expect(postUatGenerationPromotePayload('uat/pan-cobalt-0703', vi.fn())).resolves.toBe(success);
    await expect(postUatGenerationPromotePayload('uat/pan-cobalt-0703', vi.fn())).resolves.toBe(failure);
  });

});

// PAN-3093: polyrepo projects used to be skipped outright by a guard in
// runUatTrainReconcileForProject. Now they route to the polyrepo ready set,
// polyrepo assembly, and composite staleness anchors.
describe('runUatTrainReconcile — polyrepo routing', () => {
  const POLY_ROOT = '/repos/myn';
  const MONO_ROOT = '/repos/overdeck';

  /** Deps handed to the (mocked) reconciler by the last call. */
  function capturedDeps(): UatReconcilerDeps {
    return mocks.reconcileUatGenerations.mock.calls.at(-1)![1] as UatReconcilerDeps;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMergeTrainEnabledForProject.mockReturnValue(true);
    mocks.listReadyIssuesForProject.mockReturnValue([
      { issueId: 'MIN-901', title: 'MIN-901' },
    ]);
    mocks.listUatGenerations.mockReturnValue([]);
    mocks.buildUatGenerationStore.mockReturnValue({});
    mocks.buildPolyrepoGitDeps.mockReturnValue(new Map());
    mocks.reconcileUatGenerations.mockResolvedValue({ action: 'idle', invalidated: [] });
    mocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'mind-your-now', projectName: 'MYN', projectPath: POLY_ROOT,
    });
    mocks.resolveProjectReposFromResolvedIssue.mockReturnValue([
      {
        projectKey: 'mind-your-now', projectPath: POLY_ROOT, repoKey: 'fe',
        repoPath: `${POLY_ROOT}/fe`, forge: 'github', sourceBranch: 'feature/min-901',
        targetBranch: 'main', mergeOrder: 0, required: true,
      },
    ]);
  });

  // The removed guard returned no-queue before any git work; reaching the
  // reconciler at all is the runtime proof that it is gone.
  it('reconciles a polyrepo project instead of skipping it', async () => {
    mocks.findProjectByPath.mockReturnValue({
      name: 'myn', path: POLY_ROOT, workspace: { type: 'polyrepo' },
    });

    const result = await runUatTrainReconcile({ projectRoot: POLY_ROOT });

    expect(mocks.reconcileUatGenerations).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ action: 'idle', invalidated: [] });
  });

  it('gives the polyrepo path composite anchor deps', async () => {
    mocks.findProjectByPath.mockReturnValue({
      name: 'myn', path: POLY_ROOT, workspace: { type: 'polyrepo' },
    });

    await runUatTrainReconcile({ projectRoot: POLY_ROOT });

    const deps = capturedDeps();
    expect(deps.getBaseAnchor).toBeTypeOf('function');
    expect(deps.getFeatureAnchor).toBeTypeOf('function');
  });

  it('checks containment for read-only generation repositories', async () => {
    mocks.findProjectByPath.mockReturnValue({
      name: 'myn', path: POLY_ROOT, workspace: { type: 'polyrepo' },
    });
    const isBranchContainedInMain = vi.fn().mockResolvedValue(true);
    mocks.buildPolyrepoGitDeps.mockReturnValue(new Map([
      ['docs', { isBranchContainedInMain }],
    ]));

    await runUatTrainReconcile({ projectRoot: POLY_ROOT });
    const contained = await capturedDeps().isGenerationContainedInMain!({
      name: 'uat/min-otter-0727',
      repos: [{ repoKey: 'docs', branch: 'feature/min-901' }],
    } as UatGeneration);

    expect(mocks.buildPolyrepoGitDeps).toHaveBeenCalledWith(expect.any(Array), { includeReadOnly: true });
    expect(isBranchContainedInMain).toHaveBeenCalledWith('feature/min-901');
    expect(contained).toBe(true);
  });

  it('invokes polyrepo assembly, not the monorepo engine, for a polyrepo project', async () => {
    mocks.findProjectByPath.mockReturnValue({
      name: 'myn', path: POLY_ROOT, workspace: { type: 'polyrepo' },
    });
    mocks.assemblePolyrepoUatGeneration.mockResolvedValue({ name: 'uat/min-otter-0727' });

    await runUatTrainReconcile({ projectRoot: POLY_ROOT });

    // Drive the assemble hook the reconciler was handed.
    await capturedDeps().assemble([
      {
        issueId: 'MIN-901',
        title: 'One',
        branch: 'feature/min-901',
        repoContributions: [{
          repoKey: 'fe', repoPath: `${POLY_ROOT}/fe`, branch: 'feature/min-901',
          targetBranch: 'main', mergeOrder: 0,
        }],
      },
    ]);

    expect(mocks.assemblePolyrepoUatGeneration).toHaveBeenCalledTimes(1);
    const [assembleInput] = mocks.assemblePolyrepoUatGeneration.mock.calls[0]!;
    expect(assembleInput.projectRoot).toBe(POLY_ROOT);
    expect(assembleInput.repos.map((r: { repoKey: string }) => r.repoKey)).toEqual(['fe']);
  });

  it('leaves the monorepo path on single-SHA staleness with no anchor deps', async () => {
    mocks.findProjectByPath.mockReturnValue({ name: 'overdeck', path: MONO_ROOT });

    await runUatTrainReconcile({ projectRoot: MONO_ROOT });

    const deps = capturedDeps();
    expect(deps.getBaseAnchor).toBeUndefined();
    expect(deps.getFeatureAnchor).toBeUndefined();
    expect(mocks.assemblePolyrepoUatGeneration).not.toHaveBeenCalled();
  });
});

// PAN-3093 review: terminal generations still own branches, worktrees, and a
// wrapper folder. Promoting the last ready batch leaves zero candidates and
// zero live rows, which used to return early and leak every artifact.
describe('runUatTrainReconcile — terminal generation cleanup', () => {
  const POLY_ROOT = '/repos/myn';

  function terminalGen(overrides: Partial<UatGeneration> = {}): UatGeneration {
    return {
      name: 'uat/min-otter-0727',
      worktreePath: `${POLY_ROOT}/workspaces/uat-min-otter-0727`,
      projectRoot: POLY_ROOT,
      baseSha: 'fe@aaa1111',
      status: 'promoted',
      members: [],
      heldOut: [],
      resolutions: [],
      stackStartedAt: null,
      cleanedAt: null,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
      ...overrides,
    } as UatGeneration;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMergeTrainEnabledForProject.mockReturnValue(true);
    mocks.listReadyIssuesForProject.mockReturnValue([]);
    mocks.buildUatGenerationStore.mockReturnValue({
      insert: vi.fn(), update: vi.fn(), listNames: () => [], listChain: () => [],
    });
    mocks.findProjectByPath.mockReturnValue({
      name: 'myn', path: POLY_ROOT, workspace: { type: 'polyrepo' },
    });
  });

  it('cleans an uncleaned promoted generation even with no candidates and no live rows', async () => {
    mocks.listUatGenerations.mockReturnValue([]);
    mocks.hasUncleanedTerminalUatGeneration.mockReturnValue(true);

    await runUatTrainReconcile({ projectRoot: POLY_ROOT });

    // Reaching the cleanup path at all is the proof; it builds its store here.
    expect(mocks.buildUatGenerationStore).toHaveBeenCalled();
    expect(mocks.reconcileUatGenerations).not.toHaveBeenCalled();
  });

  it('does no cleanup work when every terminal generation is already cleaned', async () => {
    mocks.listUatGenerations.mockReturnValue([]);
    // The idle tick must answer this with a single existence query, never by
    // hydrating the retained terminal history.
    mocks.hasUncleanedTerminalUatGeneration.mockReturnValue(false);

    const result = await runUatTrainReconcile({ projectRoot: POLY_ROOT });

    expect(mocks.buildUatGenerationStore).not.toHaveBeenCalled();
    expect(result).toEqual({ action: 'idle', invalidated: [] });
  });
});

// PAN-3093 cycle 4: an outage refreshing member-repo refs must not read as a
// verified-empty ready set. The reconciler treats [] as authoritative — it
// marks every live member departed, invalidates the generation, and tears down
// its stack — so a transient blip would destroy the current testable batch.
describe('runUatTrainReconcile — ref-refresh outage preserves the live generation', () => {
  const POLY_ROOT = '/repos/myn';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMergeTrainEnabledForProject.mockReturnValue(true);
    mocks.listReadyIssuesForProject.mockReturnValue([{ issueId: 'MIN-901', title: 'MIN-901' }]);
    mocks.listUatGenerations.mockReturnValue([{ name: 'uat/min-otter-0727', status: 'ready' }]);
    mocks.buildUatGenerationStore.mockReturnValue({});
    mocks.buildPolyrepoGitDeps.mockReturnValue(new Map());
    mocks.reconcileUatGenerations.mockResolvedValue({ action: 'no-queue', invalidated: [] });
    mocks.findProjectByPath.mockReturnValue({
      name: 'myn', path: POLY_ROOT, workspace: { type: 'polyrepo' },
    });
    mocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'mind-your-now', projectName: 'MYN', projectPath: POLY_ROOT,
    });
    mocks.resolveProjectReposFromResolvedIssue.mockReturnValue([
      {
        projectKey: 'mind-your-now', projectPath: POLY_ROOT, repoKey: 'api',
        repoPath: `${POLY_ROOT}/api`, forge: 'github', sourceBranch: 'feature/min-901',
        targetBranch: 'main', mergeOrder: 0, required: true,
      },
    ]);
  });

  it('hands the reconciler null, not an empty ready set, when a repo refresh fails', async () => {
    // computePolyrepoMergeQueueFromCandidates is the real implementation here;
    // no ChildProcessSpawner is provided, so every git call fails — exactly the
    // shape of a transport/auth outage.
    await runUatTrainReconcile({ projectRoot: POLY_ROOT });

    const deps = mocks.reconcileUatGenerations.mock.calls.at(-1)![1] as UatReconcilerDeps;
    await expect(deps.getReadySet()).resolves.toBeNull();
  });
});
