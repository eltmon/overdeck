import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listRunningAgentsMock = vi.fn();
const listLiveAgentIdsMock = vi.fn();
const getRuntimeForAgentMock = vi.fn((_agentId: string): unknown => null);

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentState: () => null,
  listRunningAgents: () => Effect.sync(() => listRunningAgentsMock()),
}));

vi.mock('../../../../src/lib/runtimes/index.js', () => ({
  getRuntimeForAgent: (agentId: string) => getRuntimeForAgentMock(agentId),
}));

// Fake terminal backend: the live inventory the health loop reads (#4109).
vi.mock('../../../../src/lib/terminal-backends/inventory.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/lib/terminal-backends/inventory.js')>(),
  listLiveAgentIds: () => listLiveAgentIdsMock(),
}));

vi.mock('../../../../src/lib/cloister/pi-cost-reconciler.js', () => ({
  reconcilePiCostEventsForRunningAgents: vi.fn(async () => undefined),
}));

import { performHealthCheck, type HealthHost } from '../../../../src/lib/cloister/service-health.js';
import { getAllAgentHealth } from '../../../../src/lib/cloister/service-status.js';

function makeHost(previous: string[]): HealthHost & { handleAgentCrash: ReturnType<typeof vi.fn> } {
  return {
    previousRunningAgents: new Set(previous),
    config: { auto_restart: { enabled: true }, auto_actions: {} } as unknown as HealthHost['config'],
    healthCheckCount: 0,
    lastCheck: null,
    lastPokeTimestamps: new Map(),
    pokeProgress: new Map(),
    previousStates: new Map(),
    activeCostAlertKeys: new Set(),
    handleAgentCrash: vi.fn(async () => undefined),
    recordHealthEvent: vi.fn(),
    emit: vi.fn(),
    pokeAgent: vi.fn(),
    killAgent: vi.fn(),
    checkHandoffTriggers: vi.fn(async () => undefined),
    checkCostAlerts: vi.fn(),
    checkSpecialistRotations: vi.fn(async () => undefined),
    mapHeartbeatSource: (source: string) => source,
  };
}

describe('performHealthCheck liveness (#4109)', () => {
  beforeEach(() => {
    listRunningAgentsMock.mockReset();
    listLiveAgentIdsMock.mockReset();
    // A Herdr agent: the tmux-only flag is false while its pane is live.
    listRunningAgentsMock.mockReturnValue([
      { id: 'agent-pan-1', issueId: 'PAN-1', role: 'work', status: 'running', tmuxActive: false },
    ]);
  });

  it('counts a live Herdr agent as running, so it is not reported crashed', async () => {
    listLiveAgentIdsMock.mockResolvedValue(new Set(['agent-pan-1']));
    const host = makeHost(['agent-pan-1']);

    await performHealthCheck(host);

    expect(host.handleAgentCrash).not.toHaveBeenCalled();
    expect([...host.previousRunningAgents]).toEqual(['agent-pan-1']);
  });

  it('reports an agent crashed once its pane leaves the backend inventory', async () => {
    listLiveAgentIdsMock.mockResolvedValue(new Set());
    const host = makeHost(['agent-pan-1']);

    await performHealthCheck(host);

    expect(host.handleAgentCrash).toHaveBeenCalledWith('agent-pan-1');
  });

  it('never reports a crash when the backend inventory is unreadable, and keeps the previous set', async () => {
    listLiveAgentIdsMock.mockResolvedValue(null);
    const host = makeHost(['agent-pan-1']);

    await performHealthCheck(host);

    expect(host.handleAgentCrash).not.toHaveBeenCalled();
    expect([...host.previousRunningAgents]).toEqual(['agent-pan-1']);
    expect(host.lastCheck).not.toBeNull();
  });
});

describe('getAllAgentHealth liveness (#4109)', () => {
  beforeEach(() => {
    getRuntimeForAgentMock.mockClear();
    listRunningAgentsMock.mockReturnValue([
      { id: 'agent-pan-1', status: 'running', tmuxActive: false },
      { id: 'agent-pan-2', status: 'stopped', tmuxActive: false },
    ]);
  });

  it('reports the agents the backend inventory lists, Herdr included', async () => {
    listLiveAgentIdsMock.mockResolvedValue(new Set(['agent-pan-1']));

    await getAllAgentHealth({} as never);

    expect(getRuntimeForAgentMock.mock.calls.map(([id]) => id)).toEqual(['agent-pan-1']);
  });

  it('falls back to the running rows when the backend inventory is unreadable', async () => {
    listLiveAgentIdsMock.mockResolvedValue(null);

    await getAllAgentHealth({} as never);

    expect(getRuntimeForAgentMock.mock.calls.map(([id]) => id)).toEqual(['agent-pan-1']);
  });
});
