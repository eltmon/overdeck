import type { DomainEvent } from '@overdeck/contracts';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendAsync: vi.fn(),
  messageAgent: vi.fn(),
  queryByType: vi.fn(),
  readFrom: vi.fn(),
}));

vi.mock('../../dashboard/server/event-store.js', () => ({
  initEventStore: vi.fn(async () => ({
    appendAsync: mocks.appendAsync,
    queryByType: mocks.queryByType,
    readFrom: mocks.readFrom,
  })),
}));

vi.mock('../agents/messaging.js', () => ({
  messageAgentWithOutcome: mocks.messageAgent,
}));

import { handleCloisterDomainEvent } from '../cloister/service-reactive.js';
import {
  LINEAR_MCP_AUTH_WAKE_COPY,
  processLinearMcpAuthWake,
} from '../linear-mcp-auth.js';

interface TestEvent {
  sequence: number;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

let events: TestEvent[] = [];

function required(sequence: number, agentId: string, issueId: string): TestEvent {
  return {
    sequence,
    type: 'linear_mcp_auth.required',
    timestamp: `2026-07-21T12:00:0${sequence}.000Z`,
    payload: { agentId, issueId, authUrl: null, expiresAt: null },
  };
}

function healthy(sequence: number): TestEvent {
  return {
    sequence,
    type: 'linear_mcp_auth.healthy',
    timestamp: `2026-07-21T12:00:0${sequence}.000Z`,
    payload: { agentId: 'operator', issueId: null, source: 'operator' },
  };
}

function notifiedEvents(): TestEvent[] {
  return events.filter(event => event.type === 'linear_mcp_auth.notified');
}

describe('Linear MCP auth wake processor', () => {
  beforeEach(() => {
    events = [];
    mocks.messageAgent.mockReset();
    mocks.messageAgent.mockResolvedValue('delivered');
    mocks.queryByType.mockReset();
    mocks.queryByType.mockImplementation((type: string, limit = 100) => (
      events
        .filter(event => event.type === type)
        .sort((a, b) => a.sequence - b.sequence)
        .slice(-limit)
    ));
    mocks.readFrom.mockImplementation((fromSequence: number) => (
      events
        .filter(event => event.sequence > fromSequence && event.type !== 'issues.snapshot')
        .sort((a, b) => a.sequence - b.sequence)
    ));
    mocks.appendAsync.mockReset();
    mocks.appendAsync.mockImplementation(async (event: Omit<DomainEvent, 'sequence'>) => {
      const sequence = events.reduce((max, candidate) => Math.max(max, candidate.sequence), 0) + 1;
      events.push({
        ...(event as unknown as Omit<TestEvent, 'sequence'>),
        sequence,
      });
      return sequence;
    });
  });

  it('reacts to healthy by delivering one wake and recording its outcome', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    await Effect.runPromise(handleCloisterDomainEvent({ type: 'linear_mcp_auth.healthy' }));

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
    );
    expect(notifiedEvents()).toHaveLength(1);
    expect(notifiedEvents()[0]?.payload).toEqual({
      agentId: 'agent-min-852',
      issueId: 'MIN-852',
      outcome: 'delivered',
      lifecycleId: 'seq-1',
    });
  });

  it('wakes every agent in the completed lifecycle exactly once', async () => {
    events.push(
      required(1, 'agent-min-852', 'MIN-852'),
      required(2, 'agent-pan-2997', 'PAN-2997'),
      healthy(3),
    );

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.messageAgent.mock.calls.map(call => call[0])).toEqual([
      'agent-min-852',
      'agent-pan-2997',
    ]);
    expect(notifiedEvents().map(event => event.payload['outcome'])).toEqual([
      'delivered',
      'delivered',
    ]);
    expect(notifiedEvents().every(event => event.payload['lifecycleId'] === 'seq-1')).toBe(true);
  });

  it('records queued when messageAgent routes a stopped or gated agent to mail', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.messageAgent.mockResolvedValue('queued');

    await processLinearMcpAuthWake();

    expect(notifiedEvents()[0]?.payload['outcome']).toBe('queued');
  });

  it('records failed when the agent no longer exists', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.messageAgent.mockRejectedValue(new Error('Agent agent-min-852 not running'));

    await expect(processLinearMcpAuthWake()).resolves.toBeUndefined();
    expect(notifiedEvents()[0]?.payload['outcome']).toBe('failed');
  });

  it('does not send another wake after notified events have been recorded', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    await processLinearMcpAuthWake();
    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(notifiedEvents()).toHaveLength(1);
  });

  it('recovers pending wake work recorded before server boot', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
    );
    expect(notifiedEvents()).toHaveLength(1);
  });

  it('drains a lifecycle that completes while an earlier wake pass is still delivering', async () => {
    // Review repro: lifecycle A closes and its wake pass starts; lifecycle B
    // for the same agent opens and closes while A's delivery is in flight.
    // The pass must not swallow B's healthy — it drains until stable and
    // wakes B too, and A's delayed notification record may not mark B handled.
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    mocks.messageAgent.mockImplementation(async () => {
      // Mid-delivery, the agent fails again and the operator re-auths:
      // lifecycle B opens and closes behind the in-flight pass.
      if (events.some(event => event.type === 'linear_mcp_auth.required' && event.sequence >= 3) === false) {
        events.push(required(3, 'agent-min-852', 'MIN-852'), healthy(4));
      }
      return 'delivered';
    });

    await processLinearMcpAuthWake();

    // Two wake rounds: one for lifecycle seq-1, one for lifecycle seq-3.
    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    const lifecycleIds = notifiedEvents().map(event => event.payload['lifecycleId']);
    expect(lifecycleIds).toEqual(['seq-1', 'seq-3']);
  });
});
