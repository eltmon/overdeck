import type { DomainEvent } from '@overdeck/contracts';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendAsync: vi.fn(),
  getLatestSequence: vi.fn(),
  messageAgent: vi.fn(),
  queryByTypesSince: vi.fn(),
}));

vi.mock('../../dashboard/server/event-store.js', () => ({
  initEventStore: vi.fn(async () => ({
    appendAsync: mocks.appendAsync,
    getLatestSequence: mocks.getLatestSequence,
    queryByTypesSince: mocks.queryByTypesSince,
  })),
}));

vi.mock('../agents/messaging.js', () => ({
  messageAgentWithOutcome: mocks.messageAgent,
}));

import { handleCloisterDomainEvent } from '../cloister/service-reactive.js';
import {
  LINEAR_MCP_AUTH_WAKE_COPY,
  _resetLinearMcpAuthProjectionCacheForTests,
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

function completionEvents(): TestEvent[] {
  return notifiedEvents().filter(event => event.payload['outcome'] !== 'delivering');
}

describe('Linear MCP auth wake processor', () => {
  beforeEach(() => {
    events = [];
    _resetLinearMcpAuthProjectionCacheForTests();
    mocks.messageAgent.mockReset();
    mocks.messageAgent.mockResolvedValue('delivered');
    mocks.queryByTypesSince.mockReset();
    mocks.queryByTypesSince.mockImplementation((types: string[], afterSequence: number) => (
      events
        .filter(event => event.sequence > afterSequence && types.includes(event.type))
        .sort((a, b) => a.sequence - b.sequence)
    ));
    mocks.getLatestSequence.mockReset();
    mocks.getLatestSequence.mockImplementation(() => (
      events.reduce((max, candidate) => Math.max(max, candidate.sequence), 0)
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

  it('reacts to healthy by claiming, delivering one wake, and recording its outcome', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    await Effect.runPromise(handleCloisterDomainEvent({ type: 'linear_mcp_auth.healthy' }));

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
    );
    const notified = notifiedEvents();
    expect(notified).toHaveLength(2);
    // Durable claim first, completion record second — both for lifecycle seq-1.
    expect(notified[0]?.payload).toEqual({
      agentId: 'agent-min-852',
      issueId: 'MIN-852',
      outcome: 'delivering',
      lifecycleId: 'seq-1',
    });
    expect(notified[1]?.payload).toEqual({
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
    expect(completionEvents().map(event => event.payload['outcome'])).toEqual([
      'delivered',
      'delivered',
    ]);
    expect(notifiedEvents().every(event => event.payload['lifecycleId'] === 'seq-1')).toBe(true);
  });

  it('records queued when messageAgent routes a stopped or gated agent to mail', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.messageAgent.mockResolvedValue('queued');

    await processLinearMcpAuthWake();

    expect(completionEvents()[0]?.payload['outcome']).toBe('queued');
  });

  it('records failed when the agent no longer exists', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.messageAgent.mockRejectedValue(new Error('Agent agent-min-852 not running'));

    await expect(processLinearMcpAuthWake()).resolves.toBeUndefined();
    expect(completionEvents()[0]?.payload['outcome']).toBe('failed');
  });

  it('does not send another wake after notified events have been recorded', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    await processLinearMcpAuthWake();
    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(notifiedEvents()).toHaveLength(2);
  });

  it('recovers pending wake work recorded before server boot', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
    );
    expect(notifiedEvents()).toHaveLength(2);
  });

  it('does not replay a delivered wake when the process dies before the completion record lands', async () => {
    // Crash window: the claim is durable, delivery succeeds, but the
    // completion append never commits (process exit). Boot recovery must see
    // the claim and skip re-delivery — at most one wake per agent per
    // lifecycle.
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    let completionAppendFailed = false;
    const realAppend = mocks.appendAsync.getMockImplementation();
    mocks.appendAsync.mockImplementation(async (event: Omit<DomainEvent, 'sequence'>) => {
      const payload = (event as { payload?: { outcome?: string } }).payload;
      if (!completionAppendFailed && payload?.outcome === 'delivered') {
        completionAppendFailed = true;
        throw new Error('process exited before commit');
      }
      return realAppend?.(event) ?? 0;
    });

    await processLinearMcpAuthWake();
    expect(mocks.messageAgent).toHaveBeenCalledOnce();

    // Boot recovery runs the same entry point.
    await processLinearMcpAuthWake();
    expect(mocks.messageAgent).toHaveBeenCalledOnce();
  });

  it('skips delivery when the durable claim cannot be recorded', async () => {
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.appendAsync.mockRejectedValue(new Error('database is locked'));

    await expect(processLinearMcpAuthWake()).resolves.toBeUndefined();

    // No claim, no delivery — an unclaimed send could replay after a crash.
    expect(mocks.messageAgent).not.toHaveBeenCalled();
  });

  it('drains a lifecycle that completes while an earlier wake pass is still delivering', async () => {
    // Review repro: lifecycle A closes and its wake pass starts; lifecycle B
    // for the same agent opens and closes while A's delivery is in flight.
    // The pass must not swallow B's healthy — it drains until stable and
    // wakes B too, and A's notification records may not mark B handled.
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
    const completionLifecycleIds = completionEvents().map(event => event.payload['lifecycleId']);
    expect(completionLifecycleIds).toEqual(['seq-1', 'seq-3']);
    // Each lifecycle got its own claim + completion pair.
    expect(notifiedEvents().filter(event => event.payload['lifecycleId'] === 'seq-1')).toHaveLength(2);
    expect(notifiedEvents().filter(event => event.payload['lifecycleId'] === 'seq-3')).toHaveLength(2);
  });
});
