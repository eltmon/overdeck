import type { StoredEvent } from '../../dashboard/server/event-store.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Deliberately NO readFrom/queryByType on the mock store: the fold must read
// only the auth-typed lifecycle slice through queryByTypesSince. Any call to
// the generic full-history readers throws a TypeError and fails the test.
const eventStoreMocks = vi.hoisted(() => ({
  appendAsync: vi.fn(),
  queryByTypesSince: vi.fn(),
  getLatestSequence: vi.fn(),
}));

vi.mock('../../dashboard/server/event-store.js', () => ({
  initEventStore: vi.fn(async () => eventStoreMocks),
}));

import {
  LINEAR_MCP_AUTH_URL_TTL_MS,
  _resetLinearMcpAuthProjectionCacheForTests,
  computeLinearMcpAuthWakeSet,
  resolveLinearMcpAuthIntervention,
} from '../linear-mcp-auth.js';

function event(
  sequence: number,
  type: StoredEvent['type'],
  timestamp: string,
  payload: Record<string, unknown>,
): StoredEvent {
  return { sequence, type, timestamp, payload };
}

function requiredEvent(
  sequence: number,
  agentId: string,
  issueId: string,
  authUrl: string | null = null,
  expiresAt: string | null = null,
  timestamp = '2026-07-21T12:00:00.000Z',
): StoredEvent {
  return event(sequence, 'linear_mcp_auth.required', timestamp, { agentId, issueId, authUrl, expiresAt });
}

function healthyEvent(sequence: number, timestamp = '2026-07-21T12:05:00.000Z'): StoredEvent {
  return event(sequence, 'linear_mcp_auth.healthy', timestamp, {
    agentId: 'operator',
    issueId: null,
    source: 'operator',
  });
}

/** Mirrors the real query: type predicate and sequence bound both applied. */
function useEvents(events: StoredEvent[]): void {
  eventStoreMocks.queryByTypesSince.mockImplementation((types: string[], afterSequence: number) => (
    events
      .filter(candidate => candidate.sequence > afterSequence && types.includes(candidate.type))
      .sort((a, b) => a.sequence - b.sequence)
  ));
  eventStoreMocks.getLatestSequence.mockImplementation(() => (
    events.reduce((max, candidate) => Math.max(max, candidate.sequence), 0)
  ));
}

describe('Linear MCP auth intervention fold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
    eventStoreMocks.appendAsync.mockReset();
    eventStoreMocks.queryByTypesSince.mockReset();
    eventStoreMocks.getLatestSequence.mockReset();
    _resetLinearMcpAuthProjectionCacheForTests();
    useEvents([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('projects one blocked agent with the default expiry', async () => {
    useEvents([
      requiredEvent(1, 'agent-min-852', 'MIN-852'),
    ]);

    await expect(resolveLinearMcpAuthIntervention()).resolves.toEqual({
      status: 'active',
      authUrl: null,
      authUrlAgentId: null,
      authUrlExpiresAt: null,
      declaredAt: '2026-07-21T12:00:00.000Z',
      blockedAgents: [{
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        declaredAt: '2026-07-21T12:00:00.000Z',
        expiresAt: '2026-07-21T12:30:00.000Z',
        notifiedAt: null,
      }],
    });
  });

  it('deduplicates multiple agents and tracks the latest authorization URL owner', async () => {
    useEvents([
      requiredEvent(1, 'agent-min-852', 'MIN-852', 'https://linear.app/oauth/authorize?state=first', '2026-07-21T12:20:00.000Z'),
      requiredEvent(2, 'agent-pan-2997', 'PAN-2997', 'https://linear.app/oauth/authorize?state=second', '2026-07-21T12:35:00.000Z', '2026-07-21T12:05:00.000Z'),
    ]);

    const intervention = await resolveLinearMcpAuthIntervention();

    expect(intervention).toMatchObject({
      status: 'active',
      authUrl: 'https://linear.app/oauth/authorize?state=second',
      authUrlAgentId: 'agent-pan-2997',
      authUrlExpiresAt: '2026-07-21T12:35:00.000Z',
      declaredAt: '2026-07-21T12:00:00.000Z',
    });
    expect(intervention.blockedAgents.map(agent => agent.agentId)).toEqual([
      'agent-min-852',
      'agent-pan-2997',
    ]);
  });

  it('changes to expired at the default TTL and returns to active after a fresh required event', async () => {
    const events = [
      requiredEvent(1, 'agent-min-852', 'MIN-852', 'https://linear.app/oauth/authorize?state=first'),
    ];
    useEvents(events);

    await vi.advanceTimersByTimeAsync(LINEAR_MCP_AUTH_URL_TTL_MS + 1);
    await expect(resolveLinearMcpAuthIntervention()).resolves.toMatchObject({ status: 'expired' });

    events.push(requiredEvent(2, 'agent-min-852', 'MIN-852', 'https://linear.app/oauth/authorize?state=refreshed', null, '2026-07-21T12:30:00.001Z'));
    useEvents(events);

    await expect(resolveLinearMcpAuthIntervention()).resolves.toMatchObject({
      status: 'active',
      authUrl: 'https://linear.app/oauth/authorize?state=refreshed',
      authUrlExpiresAt: '2026-07-21T13:00:00.001Z',
    });
  });

  it('applies notifications after close to the last completed lifecycle', async () => {
    useEvents([
      requiredEvent(1, 'agent-min-852', 'MIN-852'),
      healthyEvent(2),
      event(3, 'linear_mcp_auth.notified', '2026-07-21T12:05:01.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        outcome: 'delivered',
        lifecycleId: 'seq-1',
      }),
    ]);

    await expect(resolveLinearMcpAuthIntervention()).resolves.toMatchObject({ status: 'none' });
    await expect(computeLinearMcpAuthWakeSet()).resolves.toEqual({
      lifecycleId: 'seq-1',
      agents: [],
    });
  });

  it('keeps the wake set empty when a duplicate healthy event arrives after notification', async () => {
    useEvents([
      requiredEvent(1, 'agent-min-852', 'MIN-852'),
      healthyEvent(2),
      event(3, 'linear_mcp_auth.notified', '2026-07-21T12:05:01.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        outcome: 'delivered',
        lifecycleId: 'seq-1',
      }),
      healthyEvent(4, '2026-07-21T12:05:02.000Z'),
    ]);

    await expect(computeLinearMcpAuthWakeSet()).resolves.toEqual({
      lifecycleId: 'seq-1',
      agents: [],
    });
  });

  it('keeps every blocked agent visible and wakeable past 100 required events', async () => {
    // Regression: the old fold queried each event type with the store's
    // default 100-event cap, so enough repeated failures from one agent
    // pushed another agent's declaration out of the reconstruction window.
    const events: StoredEvent[] = [requiredEvent(1, 'agent-min-852', 'MIN-852')];
    for (let sequence = 2; sequence <= 150; sequence++) {
      events.push(requiredEvent(sequence, 'agent-pan-2997', 'PAN-2997'));
    }
    useEvents(events);

    const intervention = await resolveLinearMcpAuthIntervention();

    expect(intervention.blockedAgents.map(agent => agent.agentId)).toContain('agent-min-852');
    expect(intervention.blockedAgents).toHaveLength(2);
  });

  it('reads only the auth-typed slice even alongside a large unrelated event population', async () => {
    // Regression: the polling path must never materialize unrelated retained
    // history. The mock store has no readFrom at all, and queryByTypesSince
    // applies both predicates, so any full-table read fails this test.
    const events: StoredEvent[] = [requiredEvent(1, 'agent-min-852', 'MIN-852')];
    for (let sequence = 2; sequence <= 5000; sequence++) {
      events.push(event(sequence, 'agent.activity_changed', '2026-07-21T12:00:00.000Z', { agentId: 'agent-other' }));
    }
    events.push(healthyEvent(5001));
    useEvents(events);

    const intervention = await resolveLinearMcpAuthIntervention();

    expect(intervention.status).toBe('none');
    // Every delta query carries the auth type predicate — unrelated events
    // are filtered in SQL, never in JS.
    for (const call of eventStoreMocks.queryByTypesSince.mock.calls) {
      expect(call[0]).toEqual(expect.arrayContaining([
        'linear_mcp_auth.required',
        'linear_mcp_auth.healthy',
        'linear_mcp_auth.notified',
        'linear_mcp_auth.callback_relayed',
      ]));
    }
  });

  it('advances the projection incrementally instead of refolding history per poll', async () => {
    const events = [
      requiredEvent(1, 'agent-min-852', 'MIN-852'),
    ];
    useEvents(events);

    await resolveLinearMcpAuthIntervention();
    await resolveLinearMcpAuthIntervention();

    const calls = eventStoreMocks.queryByTypesSince.mock.calls;
    expect(calls).toHaveLength(2);
    // The second poll asks only for events after the first covered sequence.
    expect(calls[0]?.[1]).toBe(0);
    expect(calls[1]?.[1]).toBe(1);

    events.push(healthyEvent(2));
    useEvents(events);
    await expect(resolveLinearMcpAuthIntervention()).resolves.toMatchObject({ status: 'none' });
    expect(eventStoreMocks.queryByTypesSince.mock.calls[2]?.[1]).toBe(1);
  });

  it('rebuilds the projection when retention compaction empties the events table', async () => {
    const events = [requiredEvent(1, 'agent-min-852', 'MIN-852')];
    useEvents(events);
    await resolveLinearMcpAuthIntervention();

    // Retention compaction (or a purge) removed everything: the store's
    // latest sequence is now behind the covered sequence, so the cached
    // prefix is stale and the projection must restart from scratch.
    useEvents([]);

    await expect(resolveLinearMcpAuthIntervention()).resolves.toMatchObject({
      status: 'none',
      blockedAgents: [],
    });
  });

  it('applies a delayed notification only to its own lifecycle, never to a newer one', async () => {
    // The review's stranding sequence: required(A) → healthy(A) → required(B,
    // same agent) → healthy(B) → notified(A). Lifecycle B must remain
    // unwoken — A's delayed record may not mark B handled.
    useEvents([
      requiredEvent(1, 'agent-min-852', 'MIN-852'),
      healthyEvent(2, '2026-07-21T12:01:00.000Z'),
      requiredEvent(3, 'agent-min-852', 'MIN-852', null, null, '2026-07-21T12:02:00.000Z'),
      healthyEvent(4, '2026-07-21T12:03:00.000Z'),
      event(5, 'linear_mcp_auth.notified', '2026-07-21T12:03:30.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        outcome: 'delivered',
        lifecycleId: 'seq-1',
      }),
    ]);

    // B (seq-3) is the last completed lifecycle and its agent was never
    // notified — the wake set must still contain it.
    await expect(computeLinearMcpAuthWakeSet()).resolves.toEqual({
      lifecycleId: 'seq-3',
      agents: [expect.objectContaining({ agentId: 'agent-min-852', notifiedAt: null })],
    });
  });

  it('ignores a notification whose lifecycle id matches no known lifecycle', async () => {
    useEvents([
      requiredEvent(1, 'agent-min-852', 'MIN-852'),
      healthyEvent(2),
      event(3, 'linear_mcp_auth.notified', '2026-07-21T12:05:01.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        outcome: 'delivered',
        lifecycleId: 'seq-999',
      }),
    ]);

    await expect(computeLinearMcpAuthWakeSet()).resolves.toEqual({
      lifecycleId: 'seq-1',
      agents: [expect.objectContaining({ agentId: 'agent-min-852', notifiedAt: null })],
    });
  });

  it('does not treat a legacy delivering claim as a completion', async () => {
    // 'delivering' rows from earlier iterations are not completions: the
    // agent stays in the wake set (resumption is keyed by the outbox).
    useEvents([
      requiredEvent(1, 'agent-min-852', 'MIN-852'),
      healthyEvent(2),
      event(3, 'linear_mcp_auth.notified', '2026-07-21T12:05:01.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        outcome: 'delivering',
        lifecycleId: 'seq-1',
      }),
    ]);

    await expect(computeLinearMcpAuthWakeSet()).resolves.toEqual({
      lifecycleId: 'seq-1',
      agents: [expect.objectContaining({
        agentId: 'agent-min-852',
        notifiedAt: null,
      })],
    });
  });

  it('applies legacy notifications without a lifecycle id to the current lifecycle', async () => {
    useEvents([
      requiredEvent(1, 'agent-min-852', 'MIN-852'),
      healthyEvent(2),
      event(3, 'linear_mcp_auth.notified', '2026-07-21T12:05:01.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        outcome: 'delivered',
      }),
    ]);

    await expect(computeLinearMcpAuthWakeSet()).resolves.toEqual({
      lifecycleId: 'seq-1',
      agents: [],
    });
  });
});
