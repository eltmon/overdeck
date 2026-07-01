import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFailedMergeBlock,
  mergeReadySlots,
  recoverFailedMergeSlot,
  resetSwarmLoopSafetyForTests,
  type ClassifiedSwarmSlot,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

function item(id = 'wi-a', status: VBriefItem['status'] = 'running'): VBriefItem {
  return {
    id,
    title: id,
    status,
    metadata: {
      readiness: 'ready',
      files_scope: [`src/${id}.ts`],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
    },
  };
}

function doc(planItem = item()): VBriefDocument {
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
      items: [planItem],
      edges: [],
    },
  };
}

function readySlot(): ClassifiedSwarmSlot {
  return {
    itemId: 'wi-a',
    slotIndex: 1,
    status: 'in_flight',
    branch: 'feature/pan-2203-slot-1',
    agentId: 'agent-pan-2203-slot-1',
    lifecycle: 'ready-to-merge',
    exitStatus: 0,
  };
}

function mergeDeps(): Pick<CoordinateSwarmSlotsDeps, 'verifyAndMergeSlot' | 'applyTaskOperationToPlanFile'> {
  return {
    verifyAndMergeSlot: vi.fn(async () => ({
      verified: true,
      merged: false,
      conflicts: true,
      evidence: {
        verifyCommands: ['npm run typecheck'],
        expectedOutputs: ['typecheck completes without errors'],
        commandOutputs: [],
      },
    })),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
  };
}

function recoveryDeps(): Pick<
  CoordinateSwarmSlotsDeps,
  'applyTaskOperationToPlanFile'
  | 'registeredSlotCapacityAvailable'
  | 'tryReserveAdvancingSlot'
  | 'releaseAdvancingSlot'
  | 'spawnRun'
> {
  return {
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveAdvancingSlot: vi.fn(() => true),
    releaseAdvancingSlot: vi.fn(),
    spawnRun: vi.fn(async () => undefined),
  };
}

async function recordConflict(): Promise<void> {
  await mergeReadySlots('PAN-2203', '/workspace', doc(), [readySlot()], mergeDeps());
}

describe('deacon-swarm failed-merge recovery', () => {
  beforeEach(() => {
    resetSwarmLoopSafetyForTests();
  });

  it('records failed-merge and blocks auto-advance until recovery runs', async () => {
    await expect(mergeReadySlots('PAN-2203', '/workspace', doc(), [readySlot()], mergeDeps()))
      .resolves.toEqual(['[swarm] failed-merge slot 1 (item wi-a) for PAN-2203']);

    expect(getFailedMergeBlock('PAN-2203')).toEqual(expect.objectContaining({
      issueId: 'PAN-2203',
      itemId: 'wi-a',
      slotIndex: 1,
      branch: 'feature/pan-2203-slot-1',
    }));
  });

  it('retries a failed-merge slot by unblocking and re-dispatching through dispatchNextWave', async () => {
    await recordConflict();
    const fakeDeps = recoveryDeps();

    await expect(recoverFailedMergeSlot('PAN-2203', '/workspace', doc(item('wi-a', 'blocked')), 'retry', fakeDeps))
      .resolves.toEqual([
        '[swarm] retrying failed-merge slot 1 (item wi-a) for PAN-2203',
        '[swarm] dispatched implementation slot 1 (item wi-a) for PAN-2203',
      ]);

    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenCalledWith(
      '/workspace/.pan/spec.vbrief.json',
      {
        type: 'unblock',
        itemId: 'wi-a',
        writerId: 'deacon-swarm',
        reason: 'Retrying failed swarm slot after merge conflict',
      },
      '/workspace',
    );
    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({
      slotIndex: 1,
      slotItemId: 'wi-a',
    }));
    expect(getFailedMergeBlock('PAN-2203')).toBeUndefined();
  });

  it('drops a failed-merge slot by marking the item done and clearing the block', async () => {
    await recordConflict();
    const fakeDeps = recoveryDeps();

    await expect(recoverFailedMergeSlot('PAN-2203', '/workspace', doc(), 'drop', fakeDeps))
      .resolves.toEqual(['[swarm] dropped failed-merge slot 1 (item wi-a) for PAN-2203']);

    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenCalledWith(
      '/workspace/.pan/spec.vbrief.json',
      {
        type: 'done',
        itemId: 'wi-a',
        writerId: 'deacon-swarm',
        reason: 'Dropped failed swarm slot after operator recovery',
      },
      '/workspace',
    );
    expect(getFailedMergeBlock('PAN-2203')).toBeUndefined();
  });

  it('handoff keeps auto-advance paused with an operator note', async () => {
    await recordConflict();
    const fakeDeps = recoveryDeps();

    await expect(recoverFailedMergeSlot('PAN-2203', '/workspace', doc(), 'handoff', fakeDeps))
      .resolves.toEqual(['[swarm] handoff paused PAN-2203 slot 1 (item wi-a)']);

    expect(fakeDeps.applyTaskOperationToPlanFile).not.toHaveBeenCalled();
    expect(fakeDeps.spawnRun).not.toHaveBeenCalled();
    expect(getFailedMergeBlock('PAN-2203')?.note).toContain('Operator handoff required');
  });
});
