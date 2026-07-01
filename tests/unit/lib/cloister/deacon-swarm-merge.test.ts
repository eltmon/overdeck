import { describe, expect, it, vi } from 'vitest';
import { mergeReadySlots, type ClassifiedSwarmSlot, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

function doc(item: VBriefItem = itemFor('wi-1')): VBriefDocument {
  return {
    vBRIEFInfo: {
      version: '0.6',
      created: '2026-07-01T00:00:00.000Z',
      author: 'test',
      description: 'test plan',
    },
    plan: {
      id: 'pan-2203',
      title: 'test plan',
      status: 'active',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      items: [item],
      edges: [],
    },
  };
}

function itemFor(id: string): VBriefItem {
  return {
    id,
    title: id,
    status: 'running',
    metadata: {
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
    },
  };
}

function readySlot(overrides: Partial<ClassifiedSwarmSlot> = {}): ClassifiedSwarmSlot {
  return {
    itemId: 'wi-1',
    slotIndex: 1,
    status: 'in_flight',
    branch: 'feature/pan-2203-slot-1',
    agentId: 'agent-pan-2203-slot-1',
    lifecycle: 'ready-to-merge',
    exitStatus: 0,
    ...overrides,
  };
}

function deps(result: { merged: boolean; conflicts: boolean }): Pick<CoordinateSwarmSlotsDeps, 'verifyAndMergeSlot' | 'applyTaskOperationToPlanFile'> {
  return {
    verifyAndMergeSlot: vi.fn(async () => ({
      verified: true,
      merged: result.merged,
      conflicts: result.conflicts,
      evidence: {
        verifyCommands: ['npm run typecheck'],
        expectedOutputs: ['typecheck completes without errors'],
        commandOutputs: [],
      },
    })),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
  };
}

describe('deacon-swarm ready-slot merge', () => {
  it('marks the vBRIEF item done through the write door when a slot merges', async () => {
    const fakeDeps = deps({ merged: true, conflicts: false });

    await expect(mergeReadySlots('PAN-2203', '/workspace', doc(), [readySlot()], fakeDeps))
      .resolves.toEqual(['[swarm] merged slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.verifyAndMergeSlot).toHaveBeenCalledWith(
      { issueId: 'PAN-2203', featureWorkspace: '/workspace' },
      1,
      expect.objectContaining({ id: 'wi-1' }),
    );
    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenCalledWith(
      '/workspace/.pan/spec.vbrief.json',
      { type: 'done', itemId: 'wi-1', writerId: 'deacon-swarm' },
      '/workspace',
    );
  });

  it('does not write item status when verifyAndMergeSlot returns merged false', async () => {
    const fakeDeps = deps({ merged: false, conflicts: false });

    await expect(mergeReadySlots('PAN-2203', '/workspace', doc(), [readySlot()], fakeDeps))
      .resolves.toEqual([]);

    expect(fakeDeps.applyTaskOperationToPlanFile).not.toHaveBeenCalled();
  });

  it('emits failed-merge without marking done when the slot branch conflicts', async () => {
    const fakeDeps = deps({ merged: false, conflicts: true });

    await expect(mergeReadySlots('PAN-2203', '/workspace', doc(), [readySlot()], fakeDeps))
      .resolves.toEqual(['[swarm] failed-merge slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.applyTaskOperationToPlanFile).not.toHaveBeenCalled();
  });
});
