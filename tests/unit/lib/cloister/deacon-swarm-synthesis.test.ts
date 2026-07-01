import { describe, expect, it, vi } from 'vitest';
import { dispatchNextWave, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
import type { SlotReconcileResult } from '../../../../src/lib/agents/slot-reconcile.js';
import { analyzeSwarmReadiness } from '../../../../src/lib/vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

function item(
  id: string,
  filesScope: string[],
  metadata: Partial<VBriefItem['metadata']> = {},
  status: VBriefItem['status'] = 'pending',
): VBriefItem {
  return {
    id,
    title: id,
    status,
    metadata: {
      readiness: 'ready',
      files_scope: filesScope,
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
      ...metadata,
    },
  };
}

function doc(items: VBriefItem[], edges: VBriefDocument['plan']['edges']): VBriefDocument {
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
      edges,
    },
  };
}

function reconciled(): SlotReconcileResult {
  return {
    issueId: 'PAN-2203',
    merged: [
      { itemId: 'parent-a', slotIndex: 1, status: 'merged' },
      { itemId: 'parent-b', slotIndex: 2, status: 'merged' },
    ],
    inFlight: [],
    pending: [],
    branches: [],
    agents: [],
  };
}

function deps(): Pick<
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
  };
}

describe('deacon-swarm synthesis dispatch', () => {
  it('dispatches a synthesis-phase slot before implementation for a convergence item without synthesis output', async () => {
    const plan = doc([
      item('parent-a', ['src/a.ts'], {}, 'completed'),
      item('parent-b', ['src/b.ts'], {}, 'completed'),
      item('join', ['src/join.ts'], { requiresSynthesis: true }),
    ], [
      { from: 'parent-a', to: 'join', type: 'blocks' },
      { from: 'parent-b', to: 'join', type: 'blocks' },
    ]);
    const fakeDeps = deps();

    await expect(dispatchNextWave('PAN-2203', '/workspace', plan, reconciled(), analyzeSwarmReadiness(plan), fakeDeps))
      .resolves.toEqual(['[swarm] dispatched synthesis slot 1 (item join) for PAN-2203']);

    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({
      slotIndex: 1,
      slotItemId: 'join',
      prompt: expect.stringContaining('SYNTHESIS PHASE for join'),
    }));
    expect(fakeDeps.spawnRun).not.toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({
      prompt: expect.stringContaining('## Synthesis Context'),
    }));
  });

  it('dispatches implementation with synthesis context after synthesis output is persisted', async () => {
    const plan = doc([
      item('parent-a', ['src/a.ts'], {}, 'completed'),
      item('parent-b', ['src/b.ts'], {}, 'completed'),
      item('join', ['src/join.ts'], {
        requiresSynthesis: true,
        synthesisContext: 'Parent A changed the API shape; parent B updated the scheduler.',
      }),
    ], [
      { from: 'parent-a', to: 'join', type: 'blocks' },
      { from: 'parent-b', to: 'join', type: 'blocks' },
    ]);
    const fakeDeps = deps();

    await expect(dispatchNextWave('PAN-2203', '/workspace', plan, reconciled(), analyzeSwarmReadiness(plan), fakeDeps))
      .resolves.toEqual(['[swarm] dispatched implementation slot 1 (item join) for PAN-2203']);

    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({
      slotIndex: 1,
      slotItemId: 'join',
      prompt: expect.stringContaining('Parent A changed the API shape; parent B updated the scheduler.'),
    }));
  });

  it('dispatches single-parent items directly to implementation', async () => {
    const plan = doc([
      item('parent-a', ['src/a.ts'], {}, 'completed'),
      item('child', ['src/child.ts']),
    ], [
      { from: 'parent-a', to: 'child', type: 'blocks' },
    ]);
    const fakeDeps = deps();

    await expect(dispatchNextWave('PAN-2203', '/workspace', plan, {
      ...reconciled(),
      merged: [{ itemId: 'parent-a', slotIndex: 1, status: 'merged' }],
    }, analyzeSwarmReadiness(plan), fakeDeps))
      .resolves.toEqual(['[swarm] dispatched implementation slot 1 (item child) for PAN-2203']);

    expect(fakeDeps.spawnRun).toHaveBeenCalledWith('PAN-2203', 'work', expect.objectContaining({
      slotIndex: 1,
      slotItemId: 'child',
      prompt: undefined,
    }));
  });
});
