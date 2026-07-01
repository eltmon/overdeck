import { Effect } from 'effect';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const deaconMock = vi.hoisted(() => ({
  handleAgentStoppedEvent: vi.fn(async () => []),
  handleAgentStoppedForOrphanReviewerSessions: vi.fn(async () => []),
  startDeacon: vi.fn(),
  stopDeacon: vi.fn(),
  isDeaconRunning: vi.fn(() => false),
  getDeaconStatus: vi.fn(() => ({})),
  assessDeaconPatrolFreshness: vi.fn(() => ({ fresh: true })),
  getLastPatrolResult: vi.fn(() => null),
  getDeaconLogs: vi.fn(() => []),
  runPatrol: vi.fn(async () => ({ actionsToken: [] })),
}));

vi.mock('../../../../src/lib/cloister/deacon.js', () => deaconMock);

const idleStackReaperMock = vi.hoisted(() => ({
  handleAgentLifecycleEventForIdleStack: vi.fn(),
}));

vi.mock('../../../../src/lib/cloister/idle-stack-reaper.js', () => idleStackReaperMock);

const swarmMock = vi.hoisted(() => ({
  coordinateSwarmSlots: vi.fn(async () => []),
}));

vi.mock('../../../../src/lib/cloister/deacon-swarm.js', () => swarmMock);

import { handleCloisterDomainEvent } from '../../../../src/lib/cloister/service.js';
import { coordinateSwarmSlots } from '../../../../src/lib/cloister/deacon-swarm.js';

describe('service swarm fast-path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes stopped slot agents to swarm coordination for the owning issue', async () => {
    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'agent.stopped',
      payload: { agentId: 'agent-pan-2203-slot-2' },
    }));

    expect(coordinateSwarmSlots).toHaveBeenCalledTimes(1);
    expect(coordinateSwarmSlots).toHaveBeenCalledWith({ issueId: 'PAN-2203' });
  });

  it('does not route non-slot stopped agents to swarm coordination', async () => {
    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'agent.stopped',
      payload: { agentId: 'agent-pan-2203' },
    }));

    expect(coordinateSwarmSlots).not.toHaveBeenCalled();
  });
});
