import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeReadySlots, resetSwarmLoopSafetyForTests, type ClassifiedSwarmSlot, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
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
  let workspacePath: string;

  beforeEach(() => {
    resetSwarmLoopSafetyForTests();
    workspacePath = mkdtempSync(join(tmpdir(), 'pan-2203-swarm-merge-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('marks the vBRIEF item done through the write door when a slot merges', async () => {
    const fakeDeps = deps({ merged: true, conflicts: false });

    await expect(mergeReadySlots('PAN-2203', workspacePath, doc(), [readySlot()], fakeDeps))
      .resolves.toEqual(['[swarm] merged slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.verifyAndMergeSlot).toHaveBeenCalledWith(
      { issueId: 'PAN-2203', featureWorkspace: workspacePath },
      1,
      expect.objectContaining({ id: 'wi-1' }),
    );
    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenCalledWith(
      join(workspacePath, '.pan', 'spec.vbrief.json'),
      { type: 'done', itemId: 'wi-1', writerId: 'deacon-swarm' },
      workspacePath,
    );
  });

  it('does not write item status when verifyAndMergeSlot returns merged false', async () => {
    const fakeDeps = deps({ merged: false, conflicts: false });

    await expect(mergeReadySlots('PAN-2203', workspacePath, doc(), [readySlot()], fakeDeps))
      .resolves.toEqual(['[swarm] verify-failed slot 1 (item wi-1) for PAN-2203: verification failed']);

    expect(fakeDeps.applyTaskOperationToPlanFile).not.toHaveBeenCalled();
  });

  it('emits failed-merge without marking done when the slot branch conflicts', async () => {
    const fakeDeps = deps({ merged: false, conflicts: true });

    await expect(mergeReadySlots('PAN-2203', workspacePath, doc(), [readySlot()], fakeDeps))
      .resolves.toEqual(['[swarm] failed-merge slot 1 (item wi-1) for PAN-2203']);

    expect(fakeDeps.applyTaskOperationToPlanFile).not.toHaveBeenCalled();
  });
});

describe('verify-failed surfacing', () => {
  it('reports a verification failure as an action instead of dropping the slot silently', async () => {
    const { mergeReadySlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const doc = {
      vBRIEFInfo: { version: '0.6', created: '2026-07-02T00:00:00Z' },
      plan: {
        id: 'pan-903', title: 't', status: 'active',
        items: [{ id: 'wi-1', title: 'item', status: 'pending' }],
        edges: [],
      },
    };
    const deps = {
      verifyAndMergeSlot: async () => ({
        verified: false, merged: false, conflicts: false,
        evidence: {}, failure: 'typecheck failed on merged result',
      }),
      applyTaskOperationToPlanFile: async () => undefined,
    };

    const actions = await mergeReadySlots('PAN-903', '/repo/workspaces/feature-pan-903', doc as never, [
      { itemId: 'wi-1', slotIndex: 5, status: 'in_flight', lifecycle: 'ready-to-merge', branch: 'feature/pan-903-slot-5', agentId: 'agent-pan-903-slot-5' },
    ] as never, deps as never);

    expect(actions).toEqual([
      '[swarm] verify-failed slot 5 (item wi-1) for PAN-903: typecheck failed on merged result',
    ]);
  });
});
