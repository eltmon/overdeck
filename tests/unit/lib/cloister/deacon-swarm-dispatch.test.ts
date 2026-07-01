import { describe, expect, it, vi } from 'vitest';
import { dispatchNextWave, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
import type { ReconciledSlotItem, SlotReconcileResult } from '../../../../src/lib/agents/slot-reconcile.js';
import { analyzeSwarmReadiness } from '../../../../src/lib/vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

function item(id: string, filesScope: string[]): VBriefItem {
  return {
    id,
    title: id,
    status: 'pending',
    metadata: {
      readiness: 'ready',
      files_scope: filesScope,
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
    },
  };
}

function doc(items: VBriefItem[]): VBriefDocument {
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

function mergedSlot(itemId: string, slotIndex = 1): ReconciledSlotItem {
  return {
    itemId,
    slotIndex,
    status: 'merged',
    branch: `feature/pan-2203-slot-${slotIndex}`,
    agentId: `agent-pan-2203-slot-${slotIndex}`,
  };
}

function deps(overrides: Partial<Pick<
  CoordinateSwarmSlotsDeps,
  'registeredSlotCapacityAvailable'
  | 'tryReserveAdvancingSlot'
  | 'releaseAdvancingSlot'
  | 'applyTaskOperationToPlanFile'
  | 'recordSlotAssignment'
  | 'clearSlotAssignment'
  | 'spawnRun'
>> = {}): Pick<
  CoordinateSwarmSlotsDeps,
  'registeredSlotCapacityAvailable'
  | 'tryReserveAdvancingSlot'
  | 'releaseAdvancingSlot'
  | 'applyTaskOperationToPlanFile'
  | 'recordSlotAssignment'
  | 'clearSlotAssignment'
  | 'spawnRun'
> {
  return {
    registeredSlotCapacityAvailable: vi.fn(() => true),
    tryReserveAdvancingSlot: vi.fn(() => true),
    releaseAdvancingSlot: vi.fn(),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined),
    recordSlotAssignment: vi.fn(),
    clearSlotAssignment: vi.fn(),
    spawnRun: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('deacon-swarm next-wave dispatch', () => {
  it('dispatches two non-overlapping items into distinct slots when capacity is free', async () => {
    const plan = doc([
      item('wi-a', ['src/a.ts']),
      item('wi-b', ['src/b.ts']),
    ]);
    const fakeDeps = deps();

    await expect(dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled(),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    )).resolves.toEqual([
      '[swarm] dispatched implementation slot 1 (item wi-a) for PAN-2203',
      '[swarm] dispatched implementation slot 2 (item wi-b) for PAN-2203',
    ]);

    expect(fakeDeps.spawnRun).toHaveBeenCalledTimes(2);
    expect(fakeDeps.recordSlotAssignment).toHaveBeenNthCalledWith(
      1,
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      {
        slotIndex: 1,
        itemId: 'wi-a',
        agentId: 'agent-pan-2203-slot-1',
        branch: 'feature/pan-2203-slot-1',
      },
    );
    expect(fakeDeps.recordSlotAssignment).toHaveBeenNthCalledWith(
      2,
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      {
        slotIndex: 2,
        itemId: 'wi-b',
        agentId: 'agent-pan-2203-slot-2',
        branch: 'feature/pan-2203-slot-2',
      },
    );
    expect(fakeDeps.spawnRun).toHaveBeenNthCalledWith(1, 'PAN-2203', 'work', {
      workspace: '/repo/workspaces/feature-pan-2203',
      slotIndex: 1,
      slotItemId: 'wi-a',
    });
    expect(fakeDeps.spawnRun).toHaveBeenNthCalledWith(2, 'PAN-2203', 'work', {
      workspace: '/repo/workspaces/feature-pan-2203',
      slotIndex: 2,
      slotItemId: 'wi-b',
    });
  });

  it('defers an item whose files_scope overlaps a running or selected item', async () => {
    const plan = doc([
      item('wi-a', ['src/shared.ts']),
      item('wi-b', ['src/shared.ts']),
    ]);
    const fakeDeps = deps();

    await expect(dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled(),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    )).resolves.toEqual([
      '[swarm] dispatched implementation slot 1 (item wi-a) for PAN-2203',
      '[swarm] deferred wi-b for PAN-2203: files_scope overlaps wi-a',
    ]);

    expect(fakeDeps.spawnRun).toHaveBeenCalledTimes(1);
  });

  it('defers dispatch when the registered slot cap is reached', async () => {
    const plan = doc([item('wi-a', ['src/a.ts'])]);
    const fakeDeps = deps({
      registeredSlotCapacityAvailable: vi.fn(() => false),
    });

    await expect(dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled(),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    )).resolves.toEqual(['[swarm] deferred wi-a for PAN-2203: registered slot cap reached']);

    expect(fakeDeps.spawnRun).not.toHaveBeenCalled();
    expect(fakeDeps.tryReserveAdvancingSlot).not.toHaveBeenCalled();
  });

  it('releases the item claim and advancing-slot budget when spawnRun throws', async () => {
    const plan = doc([item('wi-a', ['src/a.ts'])]);
    const fakeDeps = deps({
      spawnRun: vi.fn(async () => {
        throw new Error('spawn failed');
      }),
    });

    await expect(dispatchNextWave(
      'PAN-2203',
      '/repo/workspaces/feature-pan-2203',
      plan,
      reconciled({ merged: [mergedSlot('wi-parent')] }),
      analyzeSwarmReadiness(plan),
      fakeDeps,
    )).resolves.toEqual(['[swarm] failed-dispatch wi-a for PAN-2203: spawn failed']);

    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenNthCalledWith(
      1,
      '/repo/workspaces/feature-pan-2203/.pan/spec.vbrief.json',
      { type: 'claim', itemId: 'wi-a', writerId: 'deacon-swarm' },
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.applyTaskOperationToPlanFile).toHaveBeenNthCalledWith(
      2,
      '/repo/workspaces/feature-pan-2203/.pan/spec.vbrief.json',
      {
        type: 'unblock',
        itemId: 'wi-a',
        writerId: 'deacon-swarm',
        reason: 'slot dispatch failed: spawn failed',
      },
      '/repo/workspaces/feature-pan-2203',
    );
    expect(fakeDeps.clearSlotAssignment).toHaveBeenCalledWith(
      '/repo/workspaces/feature-pan-2203',
      'PAN-2203',
      1,
      'wi-a',
    );
    expect(fakeDeps.releaseAdvancingSlot).toHaveBeenCalledTimes(1);
  });
});
