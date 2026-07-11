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
} from '../uat-train.js';
import type { UatGeneration } from '../../../../lib/overdeck/merge-types.js';
import type { PromoteResult } from '../../../../lib/cloister/uat-promote.js';

const mocks = vi.hoisted(() => ({
  findProjectByPathSync: vi.fn(),
  getDashboardIdentity: vi.fn(),
  readCurrentFlywheelStatusForDashboard: vi.fn(),
  listUatGenerationsSync: vi.fn(),
  probeUatStack: vi.fn(),
  teardownUatStack: vi.fn(),
  promoteUatGeneration: vi.fn(),
  buildUatPromoteGitDeps: vi.fn(),
  buildUatGenerationStore: vi.fn(),
  getUatGenerationSync: vi.fn(),
  notifyFlywheelOfUatPromote: vi.fn(),
  findVBriefByIssue: vi.fn(),
  readVBriefDocument: vi.fn(),
  reviewRecordEligibility: vi.fn(),
}));

vi.mock('../../../../lib/projects.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/projects.js')>();
  return {
    ...original,
    findProjectByPathSync: mocks.findProjectByPathSync,
  };
});

vi.mock('../../identity.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../identity.js')>();
  return {
    ...original,
    getDashboardIdentity: mocks.getDashboardIdentity,
  };
});

vi.mock('../flywheel-actions.js', () => ({
  readCurrentFlywheelStatusForDashboard: mocks.readCurrentFlywheelStatusForDashboard,
}));

// uat-train.ts now imports listUatGenerationsSync from overdeck/merge-sync (not database/uat-generations-db)
vi.mock('../../../../lib/overdeck/merge-sync.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/overdeck/merge-sync.js')>();
  return {
    ...original,
    getUatGenerationSync: mocks.getUatGenerationSync,
    listUatGenerationsSync: mocks.listUatGenerationsSync,
  };
});

vi.mock('../../../../lib/cloister/uat-generation-deps.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/cloister/uat-generation-deps.js')>();
  return {
    ...original,
    buildUatGenerationStore: mocks.buildUatGenerationStore,
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

vi.mock('../../../../lib/cloister/uat-promote-notify.js', () => ({
  notifyFlywheelOfUatPromote: mocks.notifyFlywheelOfUatPromote,
}));

vi.mock('../../../../lib/flywheel-merge-order.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/flywheel-merge-order.js')>();
  return {
    ...original,
    reviewRecordEligibility: mocks.reviewRecordEligibility,
  };
});

vi.mock('../../../../lib/vbrief/vbrief-index.js', () => ({
  findVBriefByIssue: mocks.findVBriefByIssue,
  readVBriefDocument: mocks.readVBriefDocument,
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

describe('getUatGenerationsPayload', () => {
  let tmp: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectByPathSync.mockReturnValue(null);
    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: process.cwd(), mode: 'primary' });
    mocks.probeUatStack.mockResolvedValue({ status: 'absent', frontendUrl: 'https://uat-pan-otter-0610.overdeck.localhost' });
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('returns [] without touching persisted generations when no flywheel run is active', async () => {
    mocks.readCurrentFlywheelStatusForDashboard.mockResolvedValue(null);
    mocks.listUatGenerationsSync.mockReturnValue([gen([
      { issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 },
    ])]);

    await expect(getUatGenerationsPayload()).resolves.toEqual([]);

    expect(mocks.listUatGenerationsSync).not.toHaveBeenCalled();
    expect(mocks.findVBriefByIssue).not.toHaveBeenCalled();
  });

  it('bounds member vBRIEF reads and reuses unchanged checklist summaries', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pan-uat-train-'));
    const pathByIssue = new Map<string, string>();
    const members = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const issueId = `PAN-${index + 1}`;
      const path = join(tmp!, `${issueId}.vbrief.json`);
      await writeFile(path, '{}');
      pathByIssue.set(issueId, path);
      return { issueId, title: issueId, branch: `feature/pan-${index + 1}`, headSha: `h${index + 1}`, mergeOrder: index + 1 };
    }));
    let activeReads = 0;
    let maxActiveReads = 0;

    mocks.readCurrentFlywheelStatusForDashboard.mockResolvedValue({ runId: 'RUN-1' });
    mocks.listUatGenerationsSync.mockReturnValue([gen(members)]);
    mocks.findVBriefByIssue.mockImplementation((_root: string, issueId: string) => Effect.succeed({
      path: pathByIssue.get(issueId)!,
      lifecycleDir: 'proposed',
      issueId,
      slug: issueId.toLowerCase(),
      date: '2026-06-10',
      filename: `${issueId}.vbrief.json`,
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

    expect(first[0]!.members).toHaveLength(8);
    expect(second[0]!.members[0]!.acceptanceCriteria).toEqual(first[0]!.members[0]!.acceptanceCriteria);
    expect(maxActiveReads).toBeLessThanOrEqual(4);
    expect(mocks.findVBriefByIssue).toHaveBeenCalledTimes(8);
    expect(mocks.readVBriefDocument).toHaveBeenCalledTimes(8);
  });
});

describe('getUatCandidatePayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectByPathSync.mockReturnValue(null);
    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: process.cwd(), mode: 'primary' });
  });

  it('returns the newest ready generation as the active UAT candidate', async () => {
    mocks.listUatGenerationsSync.mockReturnValue([gen([
      { issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Two', branch: 'feature/pan-2', headSha: 'h2', mergeOrder: 2 },
    ])]);

    await expect(getUatCandidatePayload()).resolves.toEqual({
      branchName: 'uat/pan-otter-0610',
      bundled: ['PAN-1', 'PAN-2'],
      status: 'ready',
    });
    expect(mocks.listUatGenerationsSync).toHaveBeenCalledWith({
      projectRoot: resolveUatProjectRoot(),
      statuses: ['ready'],
      limit: 1,
    });
  });

  it('returns null when no ready UAT candidate exists', async () => {
    mocks.listUatGenerationsSync.mockReturnValue([]);

    await expect(getUatCandidatePayload()).resolves.toBeNull();
  });
});

describe('UAT train project root and startup gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectByPathSync.mockReturnValue(null);
  });

  it('resolves feature workspace cwd back to the project root', () => {
    expect(resolveUatProjectRoot('/repo/workspaces/feature-pan-2148')).toBe('/repo');
    expect(resolveUatProjectRoot('/repo/workspaces/feature-pan-2148/workspaces/uat-pan-cobalt-0703')).toBe('/repo');
  });

  it('prefers the registered project root when the registry matches the cwd', () => {
    mocks.findProjectByPathSync.mockReturnValue({ path: '/registered/repo' });

    expect(resolveUatProjectRoot('/registered/repo/workspaces/feature-pan-2148')).toBe('/registered/repo');
  });

  it('lets only the primary dashboard process start the UAT reconciler', () => {
    mocks.findProjectByPathSync.mockReturnValue({ path: '/repo' });

    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: '/repo', mode: 'primary' });
    expect(canStartUatTrainReconciler()).toBe(true);

    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: '/repo/workspaces/feature-pan-2148', mode: 'primary' });
    expect(canStartUatTrainReconciler()).toBe(false);

    mocks.getDashboardIdentity.mockReturnValue({ repoRoot: '/repo', mode: 'peer' });
    expect(canStartUatTrainReconciler()).toBe(false);
  });
});

describe('postUatGenerationPromotePayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectByPathSync.mockReturnValue(null);
    mocks.buildUatPromoteGitDeps.mockReturnValue({ git: 'deps' });
    mocks.buildUatGenerationStore.mockReturnValue({ listChain: vi.fn(), update: vi.fn() });
    mocks.notifyFlywheelOfUatPromote.mockResolvedValue(undefined);
  });

  it('passes the promote result to notifyFlywheelOfUatPromote', async () => {
    const result: PromoteResult = {
      success: true,
      generation: 'uat/pan-cobalt-0703',
      mergeSha: 'abc123',
      members: ['PAN-2294'],
      postMergeStarted: ['PAN-2294'],
      invalidated: [],
    };
    mocks.promoteUatGeneration.mockResolvedValue(result);

    await postUatGenerationPromotePayload('uat/pan-cobalt-0703', vi.fn());

    expect(mocks.notifyFlywheelOfUatPromote).toHaveBeenCalledWith(result);
  });

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

  it('still resolves with the promote result when notifyFlywheelOfUatPromote rejects', async () => {
    const result: PromoteResult = {
      success: true,
      generation: 'uat/pan-cobalt-0703',
      mergeSha: 'abc123',
      members: ['PAN-2294'],
      postMergeStarted: ['PAN-2294'],
      invalidated: [],
    };
    mocks.promoteUatGeneration.mockResolvedValue(result);
    mocks.notifyFlywheelOfUatPromote.mockRejectedValue(new Error('delivery failed'));

    await expect(postUatGenerationPromotePayload('uat/pan-cobalt-0703', vi.fn())).resolves.toBe(result);
  });
});
