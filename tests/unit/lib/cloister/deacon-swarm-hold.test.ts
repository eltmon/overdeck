import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';
import type { CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  isDeaconGloballyPausedSync: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
  findProjectByPathSync: (projectPath: string) =>
    mocks.listProjectsSync().find(({ config }: { config: { path: string } }) => config.path === projectPath)?.config ?? null,
  // PAN-2372 WI-2: workspace-door record path now resolves the owning project;
  // these tests fixture records at the workspace .pan/records/ path, so treat
  // issues as unregistered and use the workspace-door fallback.
  resolveProjectFromIssueSync: () => null,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../../../../src/lib/overdeck/control-settings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/overdeck/control-settings.js')>()),
  isDeaconGloballyPausedSync: mocks.isDeaconGloballyPausedSync,
}));

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'overdeck-swarm-hold-'));
  mocks.listProjectsSync.mockReset();
  mocks.getReviewStatusSync.mockReset();
  mocks.setReviewStatusSync.mockReset();
  mocks.isDeaconGloballyPausedSync.mockReset();
  mocks.isDeaconGloballyPausedSync.mockReturnValue(false);
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function writeSpec(projectPath: string, issueId: string, doc: VBriefDocument): void {
  const specsDir = join(projectPath, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, `2026-07-01-${issueId}-test.vbrief.json`), JSON.stringify({
    ...doc,
    status: 'active',
  }, null, 2));
}

function makeDoc(issueId: string, itemCount: number): VBriefDocument {
  const now = '2026-07-01T00:00:00.000Z';
  return {
    vBRIEFInfo: {
      version: '0.6',
      created: now,
      author: 'test',
      description: `Plan for ${issueId}`,
    },
    plan: {
      id: issueId.toLowerCase(),
      title: `Plan for ${issueId}`,
      status: 'active',
      created: now,
      updated: now,
      items: Array.from({ length: itemCount }, (_, index) => ({
        id: `wi-${index + 1}`,
        title: `Work item ${index + 1}`,
        status: 'pending',
        metadata: {
          readiness: 'ready',
          files_scope: [`src/example-${index + 1}.ts`],
          files_scope_confidence: 'high',
          verify_commands: ['npm run typecheck'],
          expected_outputs: ['typecheck completes without errors'],
        },
      })),
      edges: [],
    },
  };
}

function setupWorkspace(issueLower: string, issueUpper: string): string {
  const projectPath = join(tempRoot, 'project');
  mkdirSync(join(projectPath, 'workspaces', `feature-${issueLower}`), { recursive: true });
  writeSpec(projectPath, issueUpper, makeDoc(issueUpper, 2));
  mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);
  return projectPath;
}

describe('coordinateSwarmSlots per-issue operator hold (PAN-2214)', () => {
  it('skips a deacon-ignored issue before any reconcile/dispatch work', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-100', 'PAN-100');
    mocks.getReviewStatusSync.mockReturnValue({ deaconIgnored: true });

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] skipped PAN-100: deacon-ignored — operator hold');
    expect(actions).not.toContain('[swarm] considered PAN-100: swarm eligible');
  });

  it('coordinates THROUGH a system-stuck issue, logging the pass (PAN-2469)', async () => {
    // PAN-2469 semantic change: `stuck` is a system-set failure marker, not an
    // operator hold. Halting coordination on it froze PAN-2388's ready slots
    // for hours. Only deaconIgnored halts coordination now.
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-101', 'PAN-101');
    mocks.getReviewStatusSync.mockReturnValue({ stuck: true, stuckReason: 'verification_stuck' });

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] PAN-101 is system-stuck (verification_stuck) — coordinating anyway (stuck no longer halts assembly, PAN-2469)');
    expect(actions).not.toContain('[swarm] skipped PAN-101: stuck — operator hold');
  });

  it('honors the hold even when coordination is filtered to that issue (reactive path)', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-102', 'PAN-102');
    mocks.getReviewStatusSync.mockReturnValue({ deaconIgnored: true });

    const actions = await coordinateSwarmSlots({ issueId: 'PAN-102' });

    expect(actions).toContain('[swarm] skipped PAN-102: deacon-ignored — operator hold');
  });

  it('coordinates normally when no hold is set', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-103', 'PAN-103');
    mocks.getReviewStatusSync.mockReturnValue(null);

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-103: swarm eligible');
  });

  it('a hold read failure fails open (coordination proceeds)', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    setupWorkspace('pan-104', 'PAN-104');
    mocks.getReviewStatusSync.mockImplementation(() => {
      throw new Error('journal unreadable');
    });

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-104: swarm eligible');
  });
});

function emptyReconcile(issueId: string) {
  return {
    issueId,
    merged: [],
    inFlight: [],
    pending: [],
    branches: [],
    agents: [],
  };
}

type DispatchDeps = Pick<
  CoordinateSwarmSlotsDeps,
  'registeredSlotCapacityAvailable'
  | 'tryReserveSwarmSlot'
  | 'releaseSwarmSlot'
  | 'applyTaskOperationToPlanFile'
  | 'recordSlotAssignment'
  | 'clearSlotAssignment'
  | 'spawnRun'
  | 'getMaxSlotIndex'
  | 'listSlotAssignments'
  | 'runGitCommand'
>;

function dispatchDeps(overrides: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveSwarmSlot: vi.fn(() => true),
    releaseSwarmSlot: vi.fn(),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
    recordSlotAssignment: vi.fn(),
    clearSlotAssignment: vi.fn(),
    spawnRun: vi.fn(async () => undefined),
    getMaxSlotIndex: vi.fn(() => 5),
    listSlotAssignments: vi.fn(() => []),
    runGitCommand: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('per-spawn freeze/hold re-check (PAN-2214 slot-20 regression)', () => {
  it('a global freeze activating mid-wave halts every subsequent spawn in the same wave', async () => {
    const { dispatchNextWave } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const { analyzeSwarmReadiness } = await import('../../../../src/lib/vbrief/swarm-readiness.js');
    mocks.getReviewStatusSync.mockReturnValue(null);
    const doc = makeDoc('PAN-105', 3);
    const deps = dispatchDeps({
      spawnRun: vi.fn(async () => {
        mocks.isDeaconGloballyPausedSync.mockReturnValue(true);
      }),
    });

    const actions = await dispatchNextWave(
      'PAN-105',
      '/repo/workspaces/feature-pan-105',
      doc,
      emptyReconcile('PAN-105'),
      analyzeSwarmReadiness(doc),
      deps,
    );

    expect(deps.spawnRun).toHaveBeenCalledTimes(1);
    expect(actions).toContain('[swarm] dispatched implementation slot 1 (item wi-1) for PAN-105');
    expect(actions).toContain('[swarm] dispatch-halted wi-2: freeze/hold active');
    expect(actions).toContain('[swarm] dispatch-halted wi-3: freeze/hold active');
  });

  it('a hold set mid-wave halts remaining spawns and unwinds the halted claim', async () => {
    const { dispatchNextWave } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const { analyzeSwarmReadiness } = await import('../../../../src/lib/vbrief/swarm-readiness.js');
    mocks.getReviewStatusSync.mockReturnValue(null);
    const doc = makeDoc('PAN-106', 2);
    const deps = dispatchDeps({
      spawnRun: vi.fn(async () => {
        mocks.getReviewStatusSync.mockReturnValue({ deaconIgnored: true });
      }),
    });

    const actions = await dispatchNextWave(
      'PAN-106',
      '/repo/workspaces/feature-pan-106',
      doc,
      emptyReconcile('PAN-106'),
      analyzeSwarmReadiness(doc),
      deps,
    );

    expect(deps.spawnRun).toHaveBeenCalledTimes(1);
    expect(actions).toContain('[swarm] dispatch-halted wi-2: freeze/hold active');
    expect(deps.applyTaskOperationToPlanFile).toHaveBeenCalledWith(
      '/repo/workspaces/feature-pan-106/.pan/spec.vbrief.json',
      {
        type: 'unblock',
        itemId: 'wi-2',
        writerId: 'deacon-swarm',
        reason: 'dispatch halted: freeze/hold active',
      },
      '/repo/workspaces/feature-pan-106',
    );
    expect(deps.clearSlotAssignment).toHaveBeenCalledWith(
      '/repo/workspaces/feature-pan-106',
      'PAN-106',
      2,
      'wi-2',
    );
    expect(deps.releaseSwarmSlot).toHaveBeenCalledTimes(1);
  });

  it('recoverFailedMergeSlot refuses its respawn under a freeze with the same halted action', async () => {
    const { recoverFailedMergeSlot, recordFailedMergeBlock } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = setupWorkspace('pan-107', 'PAN-107');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-107');
    recordFailedMergeBlock({ issueId: 'PAN-107', itemId: 'wi-1', slotIndex: 1, note: 'test block' });
    mocks.getReviewStatusSync.mockReturnValue(null);
    mocks.isDeaconGloballyPausedSync.mockReturnValue(true);
    const doc = makeDoc('PAN-107', 1);
    const deps = dispatchDeps();

    const actions = await recoverFailedMergeSlot('PAN-107', workspacePath, 1, doc, 'retry', deps);

    expect(deps.spawnRun).not.toHaveBeenCalled();
    expect(actions).toContain('[swarm] dispatch-halted wi-1: freeze/hold active');
  });
});

type CoordinateDeps = CoordinateSwarmSlotsDeps;

function makeCoordinateDeps(
  issueId: string,
  projectPath: string,
  workspacePath: string,
  overrides: Partial<CoordinateDeps> = {},
): CoordinateDeps {
  return {
    listFeatureWorkspaces: () => [{ issueId, projectPath, workspacePath }],
    reconcileSlotState: vi.fn(async (reconcileIssueId: string) => ({
      issueId: reconcileIssueId,
      merged: [],
      inFlight: [],
      pending: [],
      branches: [],
      agents: [],
    })),
    listSessionNames: vi.fn(async () => []),
    isPaneDead: vi.fn(async () => false),
    getPaneExitStatus: vi.fn(async () => null),
    getAgentRuntimeState: vi.fn(async () => ({ resolution: 'done' })),
    getPaneOutputDigest: vi.fn(async () => ''),
    getBranchTipCommitTime: vi.fn(async () => null),
    getSlotBranchAheadCount: vi.fn(async () => 0),
    isSlotWorktreeClean: vi.fn(async () => true),
    sendCompletionNudge: vi.fn(async () => {}),
    slotWorktreeExists: vi.fn(() => false),
    verifyAndMergeSlot: vi.fn(async () => ({
      verified: true,
      merged: true,
      conflicts: false,
      evidence: { verifyCommands: [], expectedOutputs: [], commandOutputs: [] },
    })),
    applyTaskOperationToPlanFile: vi.fn(async () => null),
    fireTieredCommitHooks: vi.fn(async () => []),
    recordSlotAssignment: vi.fn(),
    clearSlotAssignment: vi.fn(),
    runGitCommand: vi.fn(async () => null),
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveSwarmSlot: vi.fn(() => true),
    releaseSwarmSlot: vi.fn(),
    spawnRun: vi.fn(async () => null),
    getIssueHold: vi.fn(() => null),
    readStatusOverrides: vi.fn(() => undefined),
    readSlotCompletion: vi.fn(() => undefined),
    getFinalizedAt: vi.fn(() => undefined),
    setFinalizedAt: vi.fn(),
    shouldDispatch: vi.fn(() => true),
    getMaxSlotIndex: vi.fn(() => 4),
    listSlotAssignments: vi.fn(() => []),
    requestIssueReview: vi.fn(async () => ({ success: true, message: 'dispatched' })),
    ...overrides,
  };
}

describe('PAN-2364 coordinator continues around blocked slots', () => {
  it('emits a per-issue blocked-slots line listing every blocked slot', async () => {
    const { coordinateSwarmSlots, recordFailedMergeBlock } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = setupWorkspace('pan-200', 'PAN-200');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-200');
    recordFailedMergeBlock({ issueId: 'PAN-200', itemId: 'wi-1', slotIndex: 1, note: 'slot 1 conflict' }, workspacePath);
    recordFailedMergeBlock({ issueId: 'PAN-200', itemId: 'wi-3', slotIndex: 3, note: 'slot 3 conflict' }, workspacePath);
    mocks.getReviewStatusSync.mockReturnValue(null);
    const deps = makeCoordinateDeps('PAN-200', projectPath, workspacePath);

    const actions = await coordinateSwarmSlots({}, deps);

    expect(actions).toContain('[swarm] blocked slots for PAN-200: slot 1 (item wi-1), slot 3 (item wi-3) — other slots continue; run `pan swarm recover PAN-200 <slot>`');
  });

  it('merges a ready-to-merge slot while another slot is blocked', async () => {
    const { coordinateSwarmSlots, recordFailedMergeBlock } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = setupWorkspace('pan-201', 'PAN-201');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-201');
    recordFailedMergeBlock({ issueId: 'PAN-201', itemId: 'wi-1', slotIndex: 1, note: 'slot 1 conflict' }, workspacePath);
    mocks.getReviewStatusSync.mockReturnValue(null);
    const deps = makeCoordinateDeps('PAN-201', projectPath, workspacePath, {
      reconcileSlotState: vi.fn(async () => ({
        issueId: 'PAN-201',
        merged: [],
        inFlight: [
          { itemId: 'wi-1', slotIndex: 1, status: 'in_flight', branch: 'feature/pan-201-slot-1', agentId: 'agent-pan-201-slot-1' },
          { itemId: 'wi-2', slotIndex: 2, status: 'in_flight', branch: 'feature/pan-201-slot-2', agentId: 'agent-pan-201-slot-2' },
        ],
        pending: [],
        branches: [],
        agents: [],
      })),
    });

    const actions = await coordinateSwarmSlots({}, deps);

    expect(actions).toContain('[swarm] skipped merge slot 1 (item wi-1) for PAN-201: failed-merge block — awaiting `pan swarm recover`');
    expect(actions).toContain('[swarm] merged slot 2 (item wi-2) for PAN-201');
    expect(deps.verifyAndMergeSlot).toHaveBeenCalledTimes(1);
    expect(deps.verifyAndMergeSlot).toHaveBeenCalledWith(
      { issueId: 'PAN-201', featureWorkspace: workspacePath },
      2,
      expect.objectContaining({ id: 'wi-2' }),
    );
  });

  it('dispatches a new item to a non-blocked slot index', async () => {
    const { coordinateSwarmSlots, recordFailedMergeBlock } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = setupWorkspace('pan-202', 'PAN-202');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-202');
    recordFailedMergeBlock({ issueId: 'PAN-202', itemId: 'wi-1', slotIndex: 1, note: 'slot 1 conflict' }, workspacePath);
    mocks.getReviewStatusSync.mockReturnValue(null);
    const deps = makeCoordinateDeps('PAN-202', projectPath, workspacePath);

    const actions = await coordinateSwarmSlots({}, deps);

    expect(actions).toContain('[swarm] dispatched implementation slot 2 (item wi-2) for PAN-202');
    expect(deps.spawnRun).toHaveBeenCalledWith('PAN-202', 'work', expect.objectContaining({ slotIndex: 2, slotItemId: 'wi-2' }));
  });
});
