import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  getAgentStateSync: vi.fn(),
}));

vi.mock('../../agents.js', () => ({
  getAgentStateSync: mocks.getAgentStateSync,
}));

vi.mock('../../overdeck/cost.js', () => ({
  CostDoorLive: Layer.empty,
  CostWriter: {
    use: vi.fn((fn: (writer: { reconcile: typeof mocks.reconcile }) => Effect.Effect<unknown>) =>
      fn({ reconcile: mocks.reconcile }),
    ),
  },
}));

import { reconcilePiCostEventsForRunningAgents } from '../pi-cost-reconciler.js';

describe('reconcilePiCostEventsForRunningAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcile.mockReturnValue(Effect.succeed({ imported: 0 }));
  });

  it('reconciles codex costs when a running agent has harness codex', async () => {
    mocks.getAgentStateSync.mockReturnValue({ harness: 'codex' });

    await reconcilePiCostEventsForRunningAgents([
      { id: 'agent-pan-1', tmuxActive: true } as never,
    ]);

    expect(mocks.reconcile).toHaveBeenCalledWith({ source: 'codex' });
  });

  it('reconciles ohmypi costs when a running agent has harness ohmypi', async () => {
    mocks.getAgentStateSync.mockReturnValue({ harness: 'ohmypi' });

    await reconcilePiCostEventsForRunningAgents([
      { id: 'agent-pan-1', tmuxActive: true } as never,
    ]);

    expect(mocks.reconcile).toHaveBeenCalledWith({ source: 'ohmypi' });
  });

  it('skips reconcile when no running agent uses ohmypi or codex', async () => {
    mocks.getAgentStateSync.mockReturnValue({ harness: 'claude-code' });

    await reconcilePiCostEventsForRunningAgents([
      { id: 'agent-pan-1', tmuxActive: true } as never,
    ]);

    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
