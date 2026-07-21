import type { StoredEvent } from '../../dashboard/server/event-store.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const eventStoreMocks = vi.hoisted(() => ({
  appendAsync: vi.fn(),
  queryByType: vi.fn(),
}));

vi.mock('../../dashboard/server/event-store.js', () => ({
  initEventStore: vi.fn(async () => eventStoreMocks),
}));

import {
  LINEAR_MCP_AUTH_URL_TTL_MS,
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

function useEvents(events: StoredEvent[]): void {
  eventStoreMocks.queryByType.mockImplementation((type: string) => (
    events
      .filter(candidate => candidate.type === type)
      .sort((a, b) => b.sequence - a.sequence)
  ));
}

describe('Linear MCP auth intervention fold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
    eventStoreMocks.appendAsync.mockReset();
    eventStoreMocks.queryByType.mockReset();
    useEvents([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('projects one blocked agent with the default expiry', async () => {
    useEvents([
      event(1, 'linear_mcp_auth.required', '2026-07-21T12:00:00.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        authUrl: null,
        expiresAt: null,
      }),
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
      event(1, 'linear_mcp_auth.required', '2026-07-21T12:00:00.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        authUrl: 'https://linear.app/oauth/authorize?state=first',
        expiresAt: '2026-07-21T12:20:00.000Z',
      }),
      event(2, 'linear_mcp_auth.required', '2026-07-21T12:05:00.000Z', {
        agentId: 'agent-pan-2997',
        issueId: 'PAN-2997',
        authUrl: 'https://linear.app/oauth/authorize?state=second',
        expiresAt: '2026-07-21T12:35:00.000Z',
      }),
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
      event(1, 'linear_mcp_auth.required', '2026-07-21T12:00:00.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        authUrl: 'https://linear.app/oauth/authorize?state=first',
        expiresAt: null,
      }),
    ];
    useEvents(events);

    await vi.advanceTimersByTimeAsync(LINEAR_MCP_AUTH_URL_TTL_MS + 1);
    await expect(resolveLinearMcpAuthIntervention()).resolves.toMatchObject({ status: 'expired' });

    events.push(event(2, 'linear_mcp_auth.required', '2026-07-21T12:30:00.001Z', {
      agentId: 'agent-min-852',
      issueId: 'MIN-852',
      authUrl: 'https://linear.app/oauth/authorize?state=refreshed',
      expiresAt: null,
    }));
    useEvents(events);

    await expect(resolveLinearMcpAuthIntervention()).resolves.toMatchObject({
      status: 'active',
      authUrl: 'https://linear.app/oauth/authorize?state=refreshed',
      authUrlExpiresAt: '2026-07-21T13:00:00.001Z',
    });
  });

  it('applies notifications after close to the last completed lifecycle', async () => {
    useEvents([
      event(1, 'linear_mcp_auth.required', '2026-07-21T12:00:00.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        authUrl: null,
        expiresAt: null,
      }),
      event(2, 'linear_mcp_auth.healthy', '2026-07-21T12:05:00.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        source: 'hook',
      }),
      event(3, 'linear_mcp_auth.notified', '2026-07-21T12:05:01.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        outcome: 'delivered',
      }),
    ]);

    await expect(resolveLinearMcpAuthIntervention()).resolves.toMatchObject({ status: 'none' });
    await expect(computeLinearMcpAuthWakeSet()).resolves.toEqual([]);
  });

  it('keeps the wake set empty when a duplicate healthy event arrives after notification', async () => {
    useEvents([
      event(1, 'linear_mcp_auth.required', '2026-07-21T12:00:00.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        authUrl: null,
        expiresAt: null,
      }),
      event(2, 'linear_mcp_auth.healthy', '2026-07-21T12:05:00.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        source: 'hook',
      }),
      event(3, 'linear_mcp_auth.notified', '2026-07-21T12:05:01.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        outcome: 'delivered',
      }),
      event(4, 'linear_mcp_auth.healthy', '2026-07-21T12:05:02.000Z', {
        agentId: 'agent-min-852',
        issueId: 'MIN-852',
        source: 'hook',
      }),
    ]);

    await expect(computeLinearMcpAuthWakeSet()).resolves.toEqual([]);
  });
});
