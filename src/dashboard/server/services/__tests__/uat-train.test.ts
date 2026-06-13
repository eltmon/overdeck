import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUatGenerationsPayload,
  runUatTrainReconcile,
  startUatTrainReconciler,
  stopUatTrainReconciler,
} from '../uat-train.js';
import type { UatGeneration } from '../../../../lib/database/uat-generations-db.js';
import type { MergeCandidate } from '../../../../lib/flywheel-merge-order.js';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
  isMergeTrainEnabledForProject: vi.fn(),
  buildIssueTitleMap: vi.fn(),
  listEligibleCandidatesByProject: vi.fn(),
  computeMergeQueueFromCandidates: vi.fn(),
  resolveMergeQueuePrUrl: vi.fn(),
  listUatGenerationsSync: vi.fn(),
  buildUatGenerationGitDeps: vi.fn(),
  buildUatGenerationStore: vi.fn(),
  buildUatGenerationCleanupGit: vi.fn(),
  listRemoteUatBranches: vi.fn(),
  assembleUatGeneration: vi.fn(),
  cleanupUatGenerations: vi.fn(),
  teardownUatStack: vi.fn(),
  probeUatStack: vi.fn(),
  findVBriefByIssue: vi.fn(),
  readVBriefDocument: vi.fn(),
}));

vi.mock('../../../../lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
}));

vi.mock('../../../../lib/cloister/auto-merge-policy.js', () => ({
  isMergeTrainEnabledForProject: mocks.isMergeTrainEnabledForProject,
}));

vi.mock('../issue-title-map.js', () => ({
  buildIssueTitleMap: mocks.buildIssueTitleMap,
}));

vi.mock('../../../../lib/flywheel-merge-order.js', () => ({
  listEligibleCandidatesByProject: mocks.listEligibleCandidatesByProject,
  computeMergeQueueFromCandidates: mocks.computeMergeQueueFromCandidates,
  resolveMergeQueuePrUrl: mocks.resolveMergeQueuePrUrl,
  reviewRecordEligibility: vi.fn(() => ({ eligible: true })),
}));

vi.mock('../../../../lib/database/uat-generations-db.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/database/uat-generations-db.js')>();
  return {
    ...original,
    listUatGenerationsSync: mocks.listUatGenerationsSync,
  };
});

vi.mock('../../../../lib/cloister/uat-generation-deps.js', () => ({
  buildUatGenerationGitDeps: mocks.buildUatGenerationGitDeps,
  buildUatGenerationStore: mocks.buildUatGenerationStore,
  buildUatGenerationCleanupGit: mocks.buildUatGenerationCleanupGit,
  listRemoteUatBranches: mocks.listRemoteUatBranches,
}));

vi.mock('../../../../lib/cloister/uat-generation-engine.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/cloister/uat-generation-engine.js')>();
  return {
    ...original,
    assembleUatGeneration: mocks.assembleUatGeneration,
    cleanupUatGenerations: mocks.cleanupUatGenerations,
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

vi.mock('../../../../lib/vbrief/vbrief-index.js', () => ({
  findVBriefByIssue: mocks.findVBriefByIssue,
  readVBriefDocument: mocks.readVBriefDocument,
}));

const PROJECTS = [
  { key: 'panopticon-cli', config: { name: 'Panopticon', path: '/repo/panopticon-cli' } },
  { key: 'mind-your-now', config: { name: 'Mind Your Now', path: '/repo/myn' } },
];

function gen(name: string, projectRoot: string, members: UatGeneration['members'], overrides: Partial<UatGeneration> = {}): UatGeneration {
  return {
    name,
    worktreePath: `${projectRoot}/workspaces/${name.replace(/\//g, '-')}`,
    projectRoot,
    baseSha: 'main-sha',
    status: 'ready',
    members,
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    cleanedAt: null,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

function member(issueId: string, mergeOrder = 1): UatGeneration['members'][number] {
  return {
    issueId,
    title: issueId,
    branch: `feature/${issueId.toLowerCase()}`,
    headSha: `${issueId}-sha`,
    mergeOrder,
  };
}

function doc(title: string) {
  return {
    vBRIEFInfo: {},
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

describe('uat train service', () => {
  let tmp: string | undefined;
  let chains: Map<string, UatGeneration[]>;
  let gitCalls: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    tmp = undefined;
    chains = new Map();
    gitCalls = [];

    mocks.listProjectsSync.mockReturnValue(PROJECTS);
    mocks.isMergeTrainEnabledForProject.mockReturnValue(true);
    mocks.buildIssueTitleMap.mockResolvedValue(new Map());
    mocks.resolveMergeQueuePrUrl.mockImplementation((item: { pr?: number }) => item.pr ? `https://example.test/${item.pr}` : undefined);
    mocks.listEligibleCandidatesByProject.mockReturnValue(new Map());
    mocks.computeMergeQueueFromCandidates.mockImplementation((candidates: readonly MergeCandidate[]) => Effect.succeed(
      candidates.map((candidate, index) => ({
        issueId: candidate.issueId,
        title: candidate.title,
        branchName: `feature/${candidate.issueId.toLowerCase()}`,
        ...(candidate.pr !== undefined ? { pr: candidate.pr, prUrl: `https://example.test/${candidate.pr}` } : {}),
        mergeOrder: index + 1,
        conflictsWith: [],
        batchGroup: 'batch' as const,
      })),
    ));
    mocks.listUatGenerationsSync.mockImplementation((options: { projectRoot?: string; statuses?: readonly string[]; limit?: number } = {}) => {
      const rows = [...(chains.get(options.projectRoot ?? '') ?? [])]
        .filter((row) => !options.statuses || options.statuses.includes(row.status));
      return options.limit ? rows.slice(0, options.limit) : rows;
    });
    mocks.buildUatGenerationGitDeps.mockImplementation((root: string) => {
      gitCalls.push(`build:${root}`);
      return {
        fetchMain: async () => {
          gitCalls.push(`fetch:${root}`);
          return `${root}-main`;
        },
        branchHeadSha: async (branch: string) => {
          gitCalls.push(`head:${root}:${branch}`);
          return `${branch}-sha`;
        },
      };
    });
    mocks.buildUatGenerationStore.mockReturnValue({
      insert: vi.fn(),
      update: vi.fn((name: string, patch: Partial<UatGeneration>) => {
        for (const rows of chains.values()) {
          const row = rows.find((entry) => entry.name === name);
          if (row) Object.assign(row, patch);
        }
      }),
      listNames: vi.fn(() => []),
      listChain: vi.fn((projectRoot: string, statuses?: readonly string[]) =>
        [...(chains.get(projectRoot) ?? [])].filter((row) => !statuses || statuses.includes(row.status)),
      ),
    });
    mocks.buildUatGenerationCleanupGit.mockReturnValue({
      removeWorktree: vi.fn(),
      deleteBranch: vi.fn(),
    });
    mocks.listRemoteUatBranches.mockResolvedValue([]);
    mocks.assembleUatGeneration.mockImplementation(async (input: { projectRoot: string; label: string; features: readonly { issueId: string; title: string; branch: string; pr?: number; prUrl?: string }[] }) => {
      const generation = gen(`uat/${input.label}-otter-0612`, input.projectRoot, input.features.map((feature, index) => ({
        issueId: feature.issueId,
        title: feature.title,
        branch: feature.branch,
        headSha: `${feature.branch}-sha`,
        mergeOrder: index + 1,
        ...(feature.pr !== undefined ? { pr: feature.pr } : {}),
        ...(feature.prUrl !== undefined ? { prUrl: feature.prUrl } : {}),
      })));
      chains.set(input.projectRoot, [...(chains.get(input.projectRoot) ?? []), generation]);
      return generation;
    });
    mocks.cleanupUatGenerations.mockResolvedValue(undefined);
    mocks.teardownUatStack.mockResolvedValue(undefined);
    mocks.probeUatStack.mockResolvedValue({ status: 'absent', frontendUrl: 'https://uat-pan-otter-0610.pan.localhost' });
  });

  afterEach(async () => {
    stopUatTrainReconciler();
    vi.useRealTimers();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it('does not start overlapping scheduled reconciler passes', async () => {
    vi.useFakeTimers();
    let releaseInitial!: () => void;
    mocks.buildIssueTitleMap.mockReturnValue(new Promise<void>((resolve) => {
      releaseInitial = resolve;
    }));

    startUatTrainReconciler();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.buildIssueTitleMap).toHaveBeenCalledTimes(1);

    releaseInitial();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('assembles a ready non-PAN issue in its own project without a flywheel run', async () => {
    mocks.buildIssueTitleMap.mockResolvedValue(new Map([['MIN-7', 'External ready work']]));
    mocks.listEligibleCandidatesByProject.mockImplementation((opts: { titleFor?: (issueId: string) => string | undefined }) => new Map([
      ['mind-your-now', {
        projectKey: 'mind-your-now',
        projectRoot: '/repo/myn',
        candidates: [{ issueId: 'MIN-7', title: opts.titleFor?.('MIN-7') ?? 'MIN-7', pr: 207 }],
      }],
    ]));

    const result = await runUatTrainReconcile();

    expect(result['panopticon-cli']).toEqual({ action: 'idle', invalidated: [] });
    expect(result['mind-your-now']?.action).toBe('assembled');
    expect(result['mind-your-now']?.generation?.projectRoot).toBe('/repo/myn');
    expect(mocks.assembleUatGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/repo/myn',
        label: 'min',
        features: [expect.objectContaining({ issueId: 'MIN-7', title: 'External ready work', pr: 207 })],
      }),
      expect.any(Object),
    );
  });

  it('skips a project with an empty ready set and no live generations without git work', async () => {
    mocks.listProjectsSync.mockReturnValue([PROJECTS[0]]);

    const result = await runUatTrainReconcile();

    expect(result).toEqual({ 'panopticon-cli': { action: 'idle', invalidated: [] } });
    expect(gitCalls).toEqual([]);
    expect(mocks.computeMergeQueueFromCandidates).not.toHaveBeenCalled();
    expect(mocks.assembleUatGeneration).not.toHaveBeenCalled();
  });

  it('invalidates live generations when the ready set goes empty', async () => {
    const live = gen('uat/pan-otter-0610', '/repo/panopticon-cli', [member('PAN-1')], { stackStartedAt: '2026-06-10T01:00:00.000Z' });
    chains.set('/repo/panopticon-cli', [live]);
    mocks.listProjectsSync.mockReturnValue([PROJECTS[0]]);

    const result = await runUatTrainReconcile();

    expect(result['panopticon-cli']).toEqual({ action: 'idle', invalidated: ['uat/pan-otter-0610'] });
    expect(live.status).toBe('invalidated');
    expect(mocks.teardownUatStack).toHaveBeenCalledWith(live);
  });

  it('skips disabled projects while enabled projects still reconcile', async () => {
    mocks.isMergeTrainEnabledForProject.mockImplementation((key: string) => key !== 'panopticon-cli');
    mocks.listEligibleCandidatesByProject.mockReturnValue(new Map([
      ['mind-your-now', {
        projectKey: 'mind-your-now',
        projectRoot: '/repo/myn',
        candidates: [{ issueId: 'MIN-7', title: 'MIN-7' }],
      }],
    ]));

    const result = await runUatTrainReconcile();

    expect(result['panopticon-cli']).toEqual({ action: 'disabled', invalidated: [] });
    expect(result['mind-your-now']?.action).toBe('assembled');
  });

  it('returns per-project generation chains when no flywheel run is active', async () => {
    chains.set('/repo/panopticon-cli', [gen('uat/pan-otter-0610', '/repo/panopticon-cli', [member('PAN-1')])]);
    chains.set('/repo/myn', [gen('uat/min-lynx-0610', '/repo/myn', [member('MIN-7')])]);

    const payload = await getUatGenerationsPayload();

    expect(payload.map((project) => [project.projectKey, project.projectName, project.generations.map((generation) => generation.name)])).toEqual([
      ['panopticon-cli', 'Panopticon', ['uat/pan-otter-0610']],
      ['mind-your-now', 'Mind Your Now', ['uat/min-lynx-0610']],
    ]);
  });

  it('bounds member vBRIEF reads and reuses unchanged checklist summaries per project', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pan-uat-train-'));
    const pathByIssue = new Map<string, string>();
    const members = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const issueId = `PAN-${index + 1}`;
      const path = join(tmp!, `${issueId}.vbrief.json`);
      await writeFile(path, '{}');
      pathByIssue.set(issueId, path);
      return member(issueId, index + 1);
    }));
    chains.set('/repo/panopticon-cli', [gen('uat/pan-otter-0610', '/repo/panopticon-cli', members)]);
    mocks.listProjectsSync.mockReturnValue([PROJECTS[0]]);
    let activeReads = 0;
    let maxActiveReads = 0;

    mocks.findVBriefByIssue.mockImplementation((root: string, issueId: string) => Effect.succeed({
      path: pathByIssue.get(issueId)!,
      lifecycleDir: 'proposed',
      issueId,
      slug: issueId.toLowerCase(),
      date: '2026-06-10',
      filename: `${issueId}.vbrief.json`,
      root,
    }));
    mocks.readVBriefDocument.mockImplementation((path: string) => Effect.promise(async () => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeReads -= 1;
      return doc(`AC for ${path}`) as never;
    }));

    const first = await getUatGenerationsPayload();
    const second = await getUatGenerationsPayload();

    expect(first[0]!.generations[0]!.members).toHaveLength(8);
    expect(second[0]!.generations[0]!.members[0]!.acceptanceCriteria).toEqual(first[0]!.generations[0]!.members[0]!.acceptanceCriteria);
    expect(maxActiveReads).toBeLessThanOrEqual(4);
    expect(mocks.findVBriefByIssue).toHaveBeenCalledTimes(8);
    expect(mocks.findVBriefByIssue).toHaveBeenCalledWith('/repo/panopticon-cli', 'PAN-1');
    expect(mocks.readVBriefDocument).toHaveBeenCalledTimes(8);
  });
});
