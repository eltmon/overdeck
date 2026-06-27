import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUatCandidatePayload, getUatGenerationsPayload } from '../uat-train.js';
import type { UatGeneration } from '../../../../lib/overdeck/merge-types.js';

const mocks = vi.hoisted(() => ({
  readCurrentFlywheelStatusForDashboard: vi.fn(),
  listUatGenerationsSync: vi.fn(),
  probeUatStack: vi.fn(),
  findVBriefByIssue: vi.fn(),
  readVBriefDocument: vi.fn(),
}));

vi.mock('../flywheel-actions.js', () => ({
  readCurrentFlywheelStatusForDashboard: mocks.readCurrentFlywheelStatusForDashboard,
}));

// uat-train.ts now imports listUatGenerationsSync from overdeck/merge-sync (not database/uat-generations-db)
vi.mock('../../../../lib/overdeck/merge-sync.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/overdeck/merge-sync.js')>();
  return {
    ...original,
    listUatGenerationsSync: mocks.listUatGenerationsSync,
  };
});

vi.mock('../../../../lib/cloister/uat-stack.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../lib/cloister/uat-stack.js')>();
  return {
    ...original,
    probeUatStack: mocks.probeUatStack,
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
    mocks.probeUatStack.mockResolvedValue({ status: 'absent', frontendUrl: 'https://uat-pan-otter-0610.pan.localhost' });
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
      projectRoot: process.cwd(),
      statuses: ['ready'],
      limit: 1,
    });
  });

  it('returns null when no ready UAT candidate exists', async () => {
    mocks.listUatGenerationsSync.mockReturnValue([]);

    await expect(getUatCandidatePayload()).resolves.toBeNull();
  });
});
