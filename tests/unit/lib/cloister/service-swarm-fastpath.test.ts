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

const messagingMock = vi.hoisted(() => ({
  messageAgent: vi.fn(async () => undefined),
}));

vi.mock('../../../../src/lib/agents/messaging.js', () => messagingMock);

import { handleCloisterDomainEvent } from '../../../../src/lib/cloister/service.js';

describe('service swarm fast-path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers one stopped-slot event to the owning foreman', async () => {
    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'agent.stopped',
      payload: { agentId: 'agent-pan-2203-slot-2' },
    }));

    expect(messagingMock.messageAgent).toHaveBeenCalledTimes(1);
    expect(messagingMock.messageAgent).toHaveBeenCalledWith(
      'agent-pan-2203',
      expect.stringContaining('[swarm-event] agent-pan-2203-slot-2 stopped'),
      'reactive:swarm-event',
    );
  });

  it('does not route non-slot stopped agents to swarm coordination', async () => {
    await Effect.runPromise(handleCloisterDomainEvent({
      type: 'agent.stopped',
      payload: { agentId: 'agent-pan-2203' },
    }));

    expect(messagingMock.messageAgent).not.toHaveBeenCalled();
  });
});
