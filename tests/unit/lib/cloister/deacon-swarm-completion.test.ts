import { describe, expect, it, vi } from 'vitest';
import { classifyInFlightSlots, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
import type { ReconciledSlotItem } from '../../../../src/lib/agents/slot-reconcile.js';

function slot(slotIndex: number, agentId = `agent-pan-2203-slot-${slotIndex}`): ReconciledSlotItem {
  return {
    itemId: `wi-${slotIndex}`,
    slotIndex,
    status: 'in_flight',
    agentId,
    branch: `feature/pan-2203-slot-${slotIndex}`,
  };
}

function deps(options: {
  sessions?: string[];
  dead?: Record<string, boolean>;
  exitStatus?: Record<string, number | null>;
}): Pick<CoordinateSwarmSlotsDeps, 'listSessionNames' | 'isPaneDead' | 'getPaneExitStatus'> {
  return {
    listSessionNames: vi.fn(async () => options.sessions ?? []),
    isPaneDead: vi.fn(async (sessionName: string) => options.dead?.[sessionName] ?? false),
    getPaneExitStatus: vi.fn(async (sessionName: string) => options.exitStatus?.[sessionName] ?? null),
  };
}

describe('deacon-swarm completion classification', () => {
  it('classifies a slot whose pane exited 0 as ready-to-merge', async () => {
    const agentId = 'agent-pan-2203-slot-1';

    await expect(classifyInFlightSlots([slot(1, agentId)], deps({
      sessions: [agentId],
      dead: { [agentId]: true },
      exitStatus: { [agentId]: 0 },
    }))).resolves.toEqual([
      expect.objectContaining({ slotIndex: 1, lifecycle: 'ready-to-merge', exitStatus: 0 }),
    ]);
  });

  it('classifies a slot whose pane exited non-zero as failed', async () => {
    const agentId = 'agent-pan-2203-slot-2';

    await expect(classifyInFlightSlots([slot(2, agentId)], deps({
      sessions: [agentId],
      dead: { [agentId]: true },
      exitStatus: { [agentId]: 1 },
    }))).resolves.toEqual([
      expect.objectContaining({
        slotIndex: 2,
        lifecycle: 'failed',
        exitStatus: 1,
        reason: 'pane-exit-nonzero',
      }),
    ]);
  });

  it('classifies a vanished slot as failed and a live pane as running', async () => {
    const runningAgentId = 'agent-pan-2203-slot-4';

    await expect(classifyInFlightSlots([
      slot(3, 'agent-pan-2203-slot-3'),
      slot(4, runningAgentId),
    ], deps({
      sessions: [runningAgentId],
      dead: { [runningAgentId]: false },
    }))).resolves.toEqual([
      expect.objectContaining({
        slotIndex: 3,
        lifecycle: 'failed',
        reason: 'vanished-session',
      }),
      expect.objectContaining({
        slotIndex: 4,
        lifecycle: 'running',
      }),
    ]);
  });
});
