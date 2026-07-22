import type { DomainEvent } from '@overdeck/contracts';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendAsync: vi.fn(),
  getLatestSequence: vi.fn(),
  hasMail: vi.fn(),
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
  agentHasMailContentSince: mocks.hasMail,
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

function claim(sequence: number, agentId: string, issueId: string, lifecycleId: string): TestEvent {
  return {
    sequence,
    type: 'linear_mcp_auth.notified',
    timestamp: `2026-07-21T12:00:0${sequence}.000Z`,
    payload: { agentId, issueId, outcome: 'delivering', lifecycleId },
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
    mocks.hasMail.mockReset();
    mocks.hasMail.mockReturnValue(false);
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('delivers exactly once when the process died after the claim but before the send', async () => {
    // The interrupted state: claim committed, no mail backup, no completion.
    // Boot recovery must drive the send — zero deliveries would strand the
    // blocked agent.
    events.push(
      required(1, 'agent-min-852', 'MIN-852'),
      healthy(2),
      claim(3, 'agent-min-852', 'MIN-852', 'seq-1'),
    );
    mocks.hasMail.mockReturnValue(false);

    await processLinearMcpAuthWake();

    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-min-852',
      LINEAR_MCP_AUTH_WAKE_COPY,
      'linear-mcp-auth-wake',
    );
    expect(completionEvents()).toHaveLength(1);
    expect(completionEvents()[0]?.payload['outcome']).toBe('delivered');
  });

  it('does not replay a delivered wake when the process dies before the completion record lands', async () => {
    // Crash window: claim committed, acknowledged send happened (the durable
    // mail backup exists), but the completion append never committed. Boot
    // recovery reconciles the claim against the outbox and completes the
    // ledger WITHOUT a second delivery.
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));

    // Every non-throwing messageAgent path backs the message up to the mail
    // queue — simulate that side effect on the mock.
    mocks.messageAgent.mockImplementation(async () => {
      mocks.hasMail.mockReturnValue(true);
      return 'delivered';
    });

    const realAppend = mocks.appendAsync.getMockImplementation();
    let completionAppendFailed = false;
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

    // Boot recovery runs the same entry point; the mail backup proves the
    // acknowledged send, so no replay.
    await processLinearMcpAuthWake();
    expect(mocks.messageAgent).toHaveBeenCalledOnce();
    // The interrupted claim got its completion record this time.
    expect(completionEvents()).toHaveLength(1);
    expect(completionEvents()[0]?.payload['outcome']).toBe('delivered');
  });

  it('skips delivery when the durable claim cannot be recorded', async () => {
    vi.useFakeTimers();
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    mocks.appendAsync.mockRejectedValue(new Error('database is locked'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(processLinearMcpAuthWake()).resolves.toBeUndefined();

    // No claim, no delivery — an unreconciled send could replay after a crash.
    expect(mocks.messageAgent).not.toHaveBeenCalled();
  });

  it('backs off follow-up runs when the wake set never stabilizes', async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(global, 'setTimeout');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    events.push(required(1, 'agent-min-852', 'MIN-852'), healthy(2));
    // Claims always fail, so every pass retries and no pass stabilizes.
    mocks.appendAsync.mockRejectedValue(new Error('database is locked'));

    await processLinearMcpAuthWake();
    const callsAfterFirstRun = mocks.appendAsync.mock.calls.length;
    expect(callsAfterFirstRun).toBeGreaterThan(0);

    // The follow-up is scheduled with exponential backoff, not a hot 1s loop.
    await vi.advanceTimersByTimeAsync(1000);
    const callsAfterFirstFollowUp = mocks.appendAsync.mock.calls.length;
    expect(callsAfterFirstFollowUp).toBeGreaterThan(callsAfterFirstRun);

    const delays = timeoutSpy.mock.calls.map(call => call[1]);
    expect(delays).toEqual([1000, 2000]);
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
