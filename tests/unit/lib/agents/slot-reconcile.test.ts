import { describe, expect, it, vi } from 'vitest';
import {
  listSlotAgents,
  reconcileSlotState,
  type ReconciledSlotAgent,
  type ReconciledSlotAssignment,
  type ReconciledSlotBranch,
} from '../../../../src/lib/agents/slot-reconcile.js';
import { listAgentStates } from '../../../../src/lib/agents/queries.js';

vi.mock('../../../../src/lib/agents/queries.js', () => ({
  listAgentStates: vi.fn(() => []),
}));
import type { XBriefDocument } from '../../../../src/lib/xbrief/types.js';

function makeDoc(itemIds: string[]): XBriefDocument {
  return {
    xBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
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

function deps(
  branches: ReconciledSlotBranch[],
  agents: ReconciledSlotAgent[],
  assignments: ReconciledSlotAssignment[] = [],
  completions: Record<string, { slotIndex: number; itemId?: string; agentId: string; completedAt: string }> = {},
) {
  return {
    listBranches: async () => branches,
    listAgents: () => agents,
    listSlotAssignments: () => assignments,
    listSlotCompletions: () => completions,
  };
}

describe('reconcileSlotState', () => {
  it('does not infer ownership for unowned branch slots from plan order', async () => {
    const result = await reconcileSlotState('PAN-1762', '/workspace', makeDoc(['a', 'b', 'c']), {
      statusOverrides: { a: 'completed' },
      deps: deps(
        [{ slotIndex: 2, branch: 'feature/pan-1762-slot-2', merged: false }],
        [{ slotIndex: 2, agentId: 'agent-pan-1762-slot-2', status: 'running' }],
      ),
    });

    expect(result.merged).toEqual([]);
    expect(result.inFlight).toEqual([]);
    expect(result.pending).toEqual([]);
    expect(result.branches).toEqual([{ slotIndex: 2, branch: 'feature/pan-1762-slot-2', merged: false }]);
    expect(result.agents).toEqual([{ slotIndex: 2, agentId: 'agent-pan-1762-slot-2', status: 'running' }]);
  });

  it('marks a completed item merged only when durable ownership identifies its slot', async () => {
    const result = await reconcileSlotState('PAN-1762', '/workspace', makeDoc(['a', 'b']), {
      statusOverrides: { a: 'completed' },
      deps: deps(
        [{ slotIndex: 1, branch: 'feature/pan-1762-slot-1', merged: true }],
        [],
        [{ slotIndex: 1, itemId: 'a', branch: 'feature/pan-1762-slot-1' }],
      ),
    });

    expect(result.merged).toEqual([
      {
        itemId: 'a',
        slotIndex: 1,
        status: 'merged',
        branch: 'feature/pan-1762-slot-1',
        agentId: undefined,
        mergedVia: 'completed-status',
      },
    ]);
    expect(result.pending).toEqual([]);
  });

  it('uses the merged plan view to prove completion when status overrides were already applied', async () => {
    const plan = makeDoc(['a']);
    plan.plan.items[0].status = 'completed';

    const result = await reconcileSlotState('PAN-1762', '/workspace', plan, {
      deps: deps(
        [{ slotIndex: 1, branch: 'feature/pan-1762-slot-1', merged: true }],
        [{ slotIndex: 1, agentId: 'agent-pan-1762-slot-1', status: 'running', slotItemId: 'a' }],
      ),
    });

    expect(result.merged[0]).toMatchObject({
      itemId: 'a',
      status: 'merged',
      mergedVia: 'completed-status',
    });
  });

  it('keeps a completed polyrepo slot in flight until the merge door consumes its completion marker', async () => {
    const plan = makeDoc(['a']);
    plan.plan.items[0].status = 'completed';

    const result = await reconcileSlotState('PAN-1762', '/workspace', plan, {
      deps: deps(
        [{ slotIndex: 1, branch: 'feature/pan-1762-slot-1', merged: true }],
        [{ slotIndex: 1, agentId: 'agent-pan-1762-slot-1', status: 'running', slotItemId: 'a' }],
        [{ slotIndex: 1, itemId: 'a', branch: 'feature/pan-1762-slot-1' }],
        { '1': { slotIndex: 1, itemId: 'a', agentId: 'agent-pan-1762-slot-1', completedAt: '2026-01-01T00:00:00Z' } },
      ),
    });

    expect(result.merged).toEqual([]);
    expect(result.inFlight).toEqual([
      expect.objectContaining({ itemId: 'a', status: 'in_flight' }),
    ]);
  });

  it('marks a completed slot merged after the merge door clears its completion marker', async () => {
    const plan = makeDoc(['a']);
    plan.plan.items[0].status = 'completed';

    const result = await reconcileSlotState('PAN-1762', '/workspace', plan, {
      deps: deps(
        [{ slotIndex: 1, branch: 'feature/pan-1762-slot-1', merged: true }],
        [],
        [{ slotIndex: 1, itemId: 'a', branch: 'feature/pan-1762-slot-1' }],
      ),
    });

    expect(result.merged).toEqual([
      expect.objectContaining({ itemId: 'a', status: 'merged', mergedVia: 'completed-status' }),
    ]);
  });

  it('does not mark a live polyrepo slot merged from wrapper branch ancestry', async () => {
    const plan = makeDoc(['a']);
    plan.plan.items[0].status = 'running';

    const result = await reconcileSlotState('PAN-1762', '/workspace', plan, {
      deps: deps(
        [{ slotIndex: 1, branch: 'feature/pan-1762-slot-1', merged: true }],
        [{ slotIndex: 1, agentId: 'agent-pan-1762-slot-1', status: 'running', slotItemId: 'a' }],
      ),
    });

    expect(result.merged).toEqual([]);
    expect(result.inFlight).toEqual([
      expect.objectContaining({ itemId: 'a', status: 'in_flight' }),
    ]);
  });

  it('returns a clean initial state when no durable slot ownership exists', async () => {
    const result = await reconcileSlotState('PAN-1762', '/workspace', makeDoc(['a', 'b']), {
      deps: deps([], []),
    });

    expect(result.merged).toEqual([]);
    expect(result.inFlight).toEqual([]);
    expect(result.pending).toEqual([]);
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
    expect(result.pending).toEqual([]);
  });

  it('uses durable slot assignments after the owning agent state is gone', async () => {
    const result = await reconcileSlotState('PAN-1762', '/workspace', makeDoc(['a', 'b', 'c']), {
      deps: deps(
        [{ slotIndex: 1, branch: 'feature/pan-1762-slot-1', merged: false }],
        [],
        [{ slotIndex: 1, itemId: 'c', branch: 'feature/pan-1762-slot-1' }],
      ),
    });

    expect(result.inFlight).toEqual([
      {
        itemId: 'c',
        slotIndex: 1,
        status: 'in_flight',
        branch: 'feature/pan-1762-slot-1',
        agentId: undefined,
      },
    ]);
    expect(result.pending).toEqual([]);
  });
});

describe('listSlotAgents', () => {
  it('excludes tombstoned retained-transcripts rows from slot occupancy (PAN-3465)', () => {
    vi.mocked(listAgentStates).mockReturnValue([
      { id: 'agent-pan-1762-slot-1', status: 'stopped', phase: 'retained-transcripts' },
      { id: 'agent-pan-1762-slot-2', status: 'running' },
    ] as never);

    const agents = listSlotAgents('PAN-1762');

    expect(agents).toEqual([
      { slotIndex: 2, agentId: 'agent-pan-1762-slot-2', status: 'running' },
    ]);
  });
});
