import { describe, expect, it } from 'vitest';
import { reconcileSlotState, type ReconciledSlotAgent, type ReconciledSlotBranch } from '../../../../src/lib/agents/slot-reconcile.js';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';

function makeDoc(itemIds: string[]): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'PAN-1762',
      title: 'PAN-1762',
      status: 'active',
      edges: [],
      items: itemIds.map(id => ({
        id,
        title: id,
        status: 'pending',
        metadata: {
          files_scope: [`src/${id}.ts`],
          files_scope_confidence: 'high',
          readiness: 'ready',
          verify_commands: ['npm test'],
          expected_outputs: ['tests pass'],
        },
      })),
    },
  };
}

function deps(branches: ReconciledSlotBranch[], agents: ReconciledSlotAgent[]) {
  return {
    listBranches: async () => branches,
    listAgents: () => agents,
  };
}

describe('reconcileSlotState', () => {
  it('uses status overrides and reserves unowned branch slots without assigning them by plan order', async () => {
    const result = await reconcileSlotState('PAN-1762', '/workspace', makeDoc(['a', 'b', 'c']), {
      statusOverrides: { a: 'completed' },
      deps: deps(
        [{ slotIndex: 2, branch: 'feature/pan-1762-slot-2', merged: false }],
        [{ slotIndex: 2, agentId: 'agent-pan-1762-slot-2', status: 'running' }],
      ),
    });

    expect(result.merged.map(item => item.itemId)).toEqual(['a']);
    expect(result.inFlight).toEqual([]);
    expect(result.pending.map(item => [item.itemId, item.slotIndex])).toEqual([['b', 3], ['c', 4]]);
    expect(result.branches).toEqual([{ slotIndex: 2, branch: 'feature/pan-1762-slot-2', merged: false }]);
    expect(result.agents).toEqual([{ slotIndex: 2, agentId: 'agent-pan-1762-slot-2', status: 'running' }]);
  });

  it('marks an item already completed in the plan as merged without branch-order ownership', async () => {
    const result = await reconcileSlotState('PAN-1762', '/workspace', makeDoc(['a', 'b']), {
      statusOverrides: { a: 'completed' },
      deps: deps(
        [{ slotIndex: 1, branch: 'feature/pan-1762-slot-1', merged: true }],
        [],
      ),
    });

    expect(result.merged).toEqual([
      {
        itemId: 'a',
        slotIndex: 2,
        status: 'merged',
        branch: undefined,
        agentId: undefined,
      },
    ]);
    expect(result.pending.map(item => item.itemId)).toEqual(['b']);
  });

  it('returns a clean initial state when no slot branches or agents exist', async () => {
    const result = await reconcileSlotState('PAN-1762', '/workspace', makeDoc(['a', 'b']), {
      deps: deps([], []),
    });

    expect(result.merged).toEqual([]);
    expect(result.inFlight).toEqual([]);
    expect(result.pending.map(item => item.itemId)).toEqual(['a', 'b']);
    expect(result.branches).toEqual([]);
    expect(result.agents).toEqual([]);
  });

  it('uses persisted slot item ownership instead of slot-eligible item order', async () => {
    const result = await reconcileSlotState('PAN-1762', '/workspace', makeDoc(['a', 'b', 'c']), {
      deps: deps(
        [{ slotIndex: 1, branch: 'feature/pan-1762-slot-1', merged: false }],
        [{ slotIndex: 1, agentId: 'agent-pan-1762-slot-1', status: 'running', slotItemId: 'c' }],
      ),
    });

    expect(result.inFlight).toEqual([
      {
        itemId: 'c',
        slotIndex: 1,
        status: 'in_flight',
        branch: 'feature/pan-1762-slot-1',
        agentId: 'agent-pan-1762-slot-1',
      },
    ]);
    expect(result.pending.map(item => item.itemId)).toEqual(['a', 'b']);
  });
});
