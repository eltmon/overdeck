import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyInFlightSlots,
  dispatchNextWave,
  getFailedMergeBlock,
  recordStalledSlotRecovery,
  resetSwarmLoopSafetyForTests,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import type { ReconciledSlotItem, SlotReconcileResult } from '../../../../src/lib/agents/slot-reconcile.js';
import { analyzeSwarmReadiness } from '../../../../src/lib/vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

const STALL_THRESHOLD_MS = 10_000;

function slot(overrides: Partial<ReconciledSlotItem> = {}): ReconciledSlotItem {
  return {
    itemId: 'wi-a',
    slotIndex: 1,
    status: 'in_flight',
    branch: 'feature/pan-2203-slot-1',
    agentId: 'agent-pan-2203-slot-1',
    ...overrides,
  };
}

function item(id = 'wi-a'): VBriefItem {
  return {
    id,
    title: id,
    status: 'pending',
    metadata: {
      readiness: 'ready',
      files_scope: [`src/${id}.ts`],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
    },
  };
}

function doc(items: VBriefItem[] = [item()]): VBriefDocument {
  return {
    vBRIEFInfo: {
      version: '0.6',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      author: 'test',
      description: 'test plan',
    },
    plan: {
      id: 'pan-2203',
      title: 'test plan',
      status: 'active',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      items,
      edges: [],
    },
  };
}

function classifyDeps(output = 'same pane output'): Pick<
  CoordinateSwarmSlotsDeps,
  'listSessionNames'
  | 'isPaneDead'
  | 'getPaneExitStatus'
  | 'getPaneOutputDigest'
  | 'getBranchTipCommitTime'
> {
  return {
    listSessionNames: vi.fn(async () => ['agent-pan-2203-slot-1']),
    isPaneDead: vi.fn(async () => false),
    getPaneExitStatus: vi.fn(async () => null),
    getPaneOutputDigest: vi.fn(async () => output),
    getBranchTipCommitTime: vi.fn(async () => new Date('2026-07-01T00:00:00.000Z').getTime()),
  };
}

type StallDispatchDeps = Pick<
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
  | 'listSessionNames'
  | 'slotWorktreeExists'
>;

function dispatchDeps(overrides: Partial<StallDispatchDeps> = {}): StallDispatchDeps {
  return {
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveSwarmSlot: vi.fn(() => true),
    releaseSwarmSlot: vi.fn(),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
    recordSlotAssignment: vi.fn(),
    clearSlotAssignment: vi.fn(),
    spawnRun: vi.fn(async () => undefined),
    getMaxSlotIndex: vi.fn(() => 4),
    listSlotAssignments: vi.fn(() => []),
    listSessionNames: vi.fn(async () => []),
    slotWorktreeExists: vi.fn(() => false),
    ...overrides,
  };
}

function reconciled(overrides: Partial<SlotReconcileResult> = {}): SlotReconcileResult {
  return {
    issueId: 'PAN-2203',
    merged: [],
    inFlight: [],
    pending: [],
    branches: [],
    agents: [],
    ...overrides,
  };
}

describe('deacon-swarm stalled-slot detection and duplicate-spawn guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    resetSwarmLoopSafetyForTests();
  });

  afterEach(() => {
    resetSwarmLoopSafetyForTests();
    vi.useRealTimers();
  });

  it('marks a running slot stalled after no branch commit or pane output progress, then escalates recovery', async () => {
    const deps = classifyDeps();

    await expect(classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      stallThresholdMs: STALL_THRESHOLD_MS,
    })).resolves.toEqual([
      expect.objectContaining({ lifecycle: 'running' }),
    ]);

    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS + 1);

    const classified = await classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      stallThresholdMs: STALL_THRESHOLD_MS,
    });

    expect(classified).toEqual([
      expect.objectContaining({
        lifecycle: 'stalled',
        reason: 'no-progress-timeout',
        stalledForMs: STALL_THRESHOLD_MS + 1,
      }),
    ]);
    expect(recordStalledSlotRecovery('PAN-2203', classified)).toEqual([
      '[swarm] stalled slot 1 (item wi-a) for PAN-2203: recovery required',
    ]);
    expect(getFailedMergeBlock('PAN-2203')).toEqual(expect.objectContaining({
      itemId: 'wi-a',
      slotIndex: 1,
      note: expect.stringContaining('stalled'),
    }));
  });

  it('keeps a fresh slot running within the threshold', async () => {
    const deps = classifyDeps();

    await classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      stallThresholdMs: STALL_THRESHOLD_MS,
    });
    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS - 1);

    await expect(classifyInFlightSlots([slot()], deps, {
      workspacePath: '/workspace',
      stallThresholdMs: STALL_THRESHOLD_MS,
    })).resolves.toEqual([
      expect.objectContaining({ lifecycle: 'running' }),
    ]);
  });

  it('advances past a live slot session the registry missed and spawns on the next index (PAN-2213)', async () => {
    const plan = doc([item('wi-a')]);
    const fakeDeps = dispatchDeps({
      listSessionNames: vi.fn(async () => ['agent-pan-2203-slot-1']),
    });

    await expect(dispatchNextWave('PAN-2203', '/workspace', plan, reconciled(), analyzeSwarmReadiness(plan), fakeDeps))
      .resolves.toEqual([
        '[swarm] slot 1 occupied for PAN-2203: live agent-pan-2203-slot-1 session already exists — advancing',
        '[swarm] dispatched implementation slot 2 (item wi-a) for PAN-2203',
      ]);

    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({ slotIndex: 2 }));
  });

  it('reserves unknown branch and worktree slots, spawning on the next free index (PAN-2213)', async () => {
    const plan = doc([item('wi-a')]);
    const fakeDeps = dispatchDeps({
      slotWorktreeExists: vi.fn((path: string) => path === '/workspace-slot-2'),
    });

    await expect(dispatchNextWave('PAN-2203', '/workspace', plan, reconciled({
      branches: [{ slotIndex: 1, branch: 'feature/pan-2203-slot-1', merged: false }],
    }), analyzeSwarmReadiness(plan), fakeDeps))
      .resolves.toEqual(['[swarm] dispatched implementation slot 3 (item wi-a) for PAN-2203']);

    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({ slotIndex: 3 }));
  });
});
