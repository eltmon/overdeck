import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const reconcileCalls: Array<{ source: string }> = [];

vi.mock('../../overdeck/cost.js', () => ({
  CostDoorLive: {},
  CostWriter: {
    use: (fn: (writer: { reconcile: (opts: { source: string }) => Promise<{ imported: number }> }) => unknown) =>
      fn({
        reconcile: async (opts: { source: string }) => {
          reconcileCalls.push(opts);
          return { imported: 0 };
        },
      }),
  },
}));

vi.mock('../../agents.js', () => ({
  getAgentStateSync: vi.fn((id: string) => {
    if (id === 'agent-codex') return { harness: 'codex' };
    if (id === 'agent-ohmypi') return { harness: 'ohmypi' };
    return { harness: 'claude-code' };
  }),
}));

import { reconcilePiCostEventsForRunningAgents } from '../pi-cost-reconciler.js';

describe('reconcilePiCostEventsForRunningAgents (PAN-2388)', () => {
  beforeEach(() => {
    reconcileCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invokes reconcile({ source: "codex" }) when a running agent has harness codex', async () => {
    await reconcilePiCostEventsForRunningAgents([
      { id: 'agent-codex', tmuxActive: true } as any,
    ]);

    expect(reconcileCalls).toContainEqual({ source: 'codex' });
  });

  it('invokes reconcile({ source: "ohmypi" }) when a running agent has harness ohmypi', async () => {
    await reconcilePiCostEventsForRunningAgents([
      { id: 'agent-ohmypi', tmuxActive: true } as any,
    ]);

    expect(reconcileCalls).toContainEqual({ source: 'ohmypi' });
  });

  it('skips both reconciles when no running agent has a tracked harness', async () => {
    await reconcilePiCostEventsForRunningAgents([
      { id: 'agent-claude', tmuxActive: true } as any,
    ]);

    expect(reconcileCalls).toHaveLength(0);
  });
});
