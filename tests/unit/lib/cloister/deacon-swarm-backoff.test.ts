import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchNextWave,
  isSwarmAdvanceCoolingDown,
  mergeReadySlots,
  recordSwarmAdvanceFailure,
  resetSwarmLoopSafetyForTests,
  type ClassifiedSwarmSlot,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import type { SlotReconcileResult } from '../../../../src/lib/agents/slot-reconcile.js';
import { analyzeSwarmReadiness } from '../../../../src/lib/vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

function item(id: string): VBriefItem {
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

function doc(items: VBriefItem[] = [item('wi-a')]): VBriefDocument {
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

function readySlot(overrides: Partial<ClassifiedSwarmSlot> = {}): ClassifiedSwarmSlot {
  return {
    itemId: 'wi-a',
    slotIndex: 1,
    status: 'in_flight',
    branch: 'feature/pan-2203-slot-1',
    agentId: 'agent-pan-2203-slot-1',
    lifecycle: 'ready-to-merge',
    exitStatus: 0,
    ...overrides,
  };
}

function mergeDeps(): Pick<CoordinateSwarmSlotsDeps, 'verifyAndMergeSlot' | 'applyTaskOperationToPlanFile'> {
  return {
    verifyAndMergeSlot: vi.fn(async () => ({
      verified: true,
      merged: true,
      conflicts: false,
      evidence: {
        verifyCommands: ['npm run typecheck'],
        expectedOutputs: ['typecheck completes without errors'],
        commandOutputs: [],
      },
    })),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
  };
}

function dispatchDeps(): Pick<
  CoordinateSwarmSlotsDeps,
  'registeredSlotCapacityAvailable'
  | 'tryReserveSwarmSlot'
  | 'releaseSwarmSlot'
  | 'applyTaskOperationToPlanFile'
  | 'spawnRun'
> {
  return {
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveSwarmSlot: vi.fn(() => true),
    releaseSwarmSlot: vi.fn(),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
    spawnRun: vi.fn(async () => undefined),
  };
}

describe('deacon-swarm loop safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    resetSwarmLoopSafetyForTests();
  });

  afterEach(() => {
    resetSwarmLoopSafetyForTests();
    vi.useRealTimers();
  });

  it('does not refire a ready-slot merge for the same branch within the cooldown window', async () => {
    const fakeDeps = mergeDeps();

    await expect(mergeReadySlots('PAN-2203', '/workspace', doc(), [readySlot()], fakeDeps))
      .resolves.toEqual(['[swarm] merged slot 1 (item wi-a) for PAN-2203']);
    await expect(mergeReadySlots('PAN-2203', '/workspace', doc(), [readySlot()], fakeDeps))
      .resolves.toEqual(['[swarm] skipped merge slot 1 (item wi-a) for PAN-2203: refire cooldown']);

    expect(fakeDeps.verifyAndMergeSlot).toHaveBeenCalledTimes(1);
  });

  it('suppresses issue advance after three failures until the backoff elapses', async () => {
    recordSwarmAdvanceFailure('PAN-2203');
    recordSwarmAdvanceFailure('PAN-2203');
    recordSwarmAdvanceFailure('PAN-2203');

    expect(isSwarmAdvanceCoolingDown('PAN-2203')).toBe(true);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(isSwarmAdvanceCoolingDown('PAN-2203')).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(isSwarmAdvanceCoolingDown('PAN-2203')).toBe(false);
  });

  it('does not dispatch a duplicate live slot item pair', async () => {
    const plan = doc([item('wi-a')]);
    const fakeDeps = dispatchDeps();
    const reconciled: SlotReconcileResult = {
      issueId: 'PAN-2203',
      merged: [],
      inFlight: [readySlot({ itemId: 'wi-a', slotIndex: 1, lifecycle: 'running' })],
      pending: [],
      branches: [],
      agents: [],
    };

    await expect(dispatchNextWave('PAN-2203', '/workspace', plan, reconciled, analyzeSwarmReadiness(plan), fakeDeps))
      .resolves.toEqual([]);

    expect(fakeDeps.spawnRun).not.toHaveBeenCalled();
  });
});
