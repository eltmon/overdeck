import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { AgentSnapshot, DomainEvent } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardStore } from '../../../../lib/store';
import {
  useConfluenceData,
  useConfluenceOrbs,
  useHookStream,
} from '../useConfluenceData';

const NOW = new Date('2026-08-02T12:00:00.000Z');

function agent(overrides: Partial<AgentSnapshot> & Pick<AgentSnapshot, 'id' | 'issueId'>): AgentSnapshot {
  return {
    status: 'running',
    role: 'work',
    model: 'gpt-5.6-sol',
    startedAt: NOW.toISOString(),
    lastActivity: NOW.toISOString(),
    ...overrides,
  } as AgentSnapshot;
}

function event(type: DomainEvent['type'], payload: Record<string, unknown>, sequence: number): DomainEvent {
  return {
    type,
    sequence,
    timestamp: NOW.toISOString(),
    payload,
  } as DomainEvent;
}

function wrapper(client: QueryClient) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const PARKED_EMPTY = { rows: [], summary: { total: 0, byOrbit: {}, primaryByIssue: {} } };
let parkedPayload = PARKED_EMPTY;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  parkedPayload = PARKED_EMPTY;
  // The test-setup fetch guard fails unexpected requests; answer /api/parked
  // with the controllable fixture and keep everything else forbidden.
  globalThis.fetch = vi.fn(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/api/parked')) {
      return new Response(JSON.stringify(parkedPayload), { status: 200 });
    }
    throw new Error(`Unexpected network request: ${url}`);
  }) as unknown as typeof fetch;
  useDashboardStore.setState({
    sequence: 0,
    agentsById: {},
    agentRuntimeById: {},
    issuesRaw: [],
    reviewStatusByIssueId: {},
    recentActivity: [],
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useConfluenceOrbs', () => {
  it('classifies live issues, maps stages and glyphs, carries health, and preserves orb identity', async () => {
    const staleAt = new Date(NOW.getTime() - 31 * 60_000).toISOString();
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-1': agent({
          id: 'agent-pan-1',
          issueId: 'PAN-1',
          role: 'plan',
          lastActivity: staleAt,
          model: 'claude-opus-5',
        }),
        'agent-pan-2': agent({
          id: 'agent-pan-2',
          issueId: 'PAN-2',
          paused: true,
          pausedReason: 'yield: freeing a slot',
        }),
        'agent-pan-3': agent({ id: 'agent-pan-3', issueId: 'PAN-3' }),
        'agent-pan-4-test': agent({
          id: 'agent-pan-4-test',
          issueId: 'PAN-4',
          role: 'test',
          model: 'claude-sonnet-5',
        }),
      },
      issuesRaw: [
        { id: 'PAN-1', identifier: 'PAN-1', title: 'Planning', labels: [] },
        { id: 'PAN-2', identifier: 'PAN-2', title: 'Yielded', labels: [] },
        { id: 'PAN-3', identifier: 'PAN-3', title: 'Wreck', labels: [] },
        { id: 'PAN-4', identifier: 'PAN-4', title: 'Testing', labels: [] },
      ],
      reviewStatusByIssueId: {
        'PAN-3': { issueId: 'PAN-3', mergeStatus: 'failed' },
        'PAN-4': { issueId: 'PAN-4', testStatus: 'testing' },
      },
    });

    const client = queryClient();
    client.setQueryData(['workspace-stack-health', ['PAN-1', 'PAN-2', 'PAN-3', 'PAN-4']], {
      workspaces: { 'PAN-4': { stackHealth: { healthy: false } } },
    });
    const { result } = renderHook(() => useConfluenceOrbs(), { wrapper: wrapper(client) });

    expect(result.current.find((orb) => orb.id === 'PAN-1')).toMatchObject({
      state: 'stale',
      stage: 'PLAN',
      glyph: 'O',
    });
    expect(result.current.find((orb) => orb.id === 'PAN-2')).toMatchObject({
      state: 'shelf',
      stage: 'WORK',
      yieldReason: 'yield: freeing a slot',
    });
    expect(result.current.find((orb) => orb.id === 'PAN-3')).toMatchObject({ state: 'failed' });
    expect(result.current.find((orb) => orb.id === 'PAN-4')).toMatchObject({
      state: 'active',
      stage: 'TEST',
      glyph: 'S',
      broken: true,
    });

    const original = result.current.find((orb) => orb.id === 'PAN-4');
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    act(() => useDashboardStore.setState((state) => ({
      agentsById: { ...state.agentsById },
      sequence: state.sequence + 1,
    })));
    expect(result.current.find((orb) => orb.id === 'PAN-4')).toBe(original);
  });

  it('maps queued work into MERGE and exposes the primary agent harness', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-5': agent({
          id: 'agent-pan-5',
          issueId: 'PAN-5',
          role: 'work',
          runtime: 'claude-code',
        }),
      },
      issuesRaw: [{ id: 'PAN-5', identifier: 'PAN-5', title: 'Queued', labels: [] }],
      reviewStatusByIssueId: {
        'PAN-5': { issueId: 'PAN-5', mergeStatus: 'queued' },
      },
    });

    const client = queryClient();
    client.setQueryData(['workspace-stack-health', ['PAN-5']], { workspaces: {} });
    const { result } = renderHook(() => useConfluenceOrbs(), { wrapper: wrapper(client) });

    expect(result.current[0]).toMatchObject({
      stage: 'MERGE',
      role: 'ship',
      mergeStatus: 'queued',
      harness: 'claude-code',
    });
  });

  it('groups four review specialists and the review parent into a five-member convoy', () => {
    const reviewAgents = [
      'agent-min-839-review-security',
      'agent-min-839-review-correctness',
      'agent-min-839-review-performance',
      'agent-min-839-review-requirements',
      'agent-min-839-review',
    ].map((id) => agent({ id, issueId: 'MIN-839', role: 'review' }));
    useDashboardStore.setState({
      agentsById: Object.fromEntries(reviewAgents.map((item) => [item.id, item])),
      issuesRaw: [{ id: 'MIN-839', identifier: 'MIN-839', title: 'Review convoy', labels: [] }],
    });

    const client = queryClient();
    client.setQueryData(['workspace-stack-health', ['MIN-839']], { workspaces: {} });
    const { result } = renderHook(() => useConfluenceOrbs(), { wrapper: wrapper(client) });
    const orb = result.current[0];

    expect(orb?.stage).toBe('REVIEW');
    expect(orb?.convoy).toHaveLength(5);
    expect(orb?.convoy?.map((member) => member.role)).toEqual([
      'security',
      'correctness',
      'performance',
      'requirements',
      'synthesis',
    ]);
  });
});

describe('useHookStream', () => {
  it('keeps the 60 second event window, preserves hook names, and decays family rates', async () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-1': agent({ id: 'agent-pan-1', issueId: 'PAN-1' }),
      },
    });
    const { result } = renderHook(() => useHookStream());

    act(() => {
      useDashboardStore.getState().applyEvents([
        event('agent.activity_changed', {
          agentId: 'agent-pan-1',
          activity: 'working',
          currentTool: 'Read',
          hookName: 'PreToolUse',
        }, 1),
        event('agent.hook_fired', {
          agentId: 'agent-pan-1',
          hookName: 'PostToolUseFailure',
          tool: 'Bash',
        }, 2),
      ]);
    });

    expect(result.current.entries).toMatchObject([
      { source: 'hook', agentId: 'agent-pan-1', issueId: 'PAN-1', tool: 'Read', hookName: 'PreToolUse', family: 'tool_read' },
      { sequence: 2, source: 'hook', agentId: 'agent-pan-1', issueId: 'PAN-1', tool: 'Bash', hookName: 'PostToolUseFailure', family: 'tool_exec' },
    ]);
    expect(result.current.eventsPerMin).toBe(2);
    expect(result.current.eventsPerSec).toBe(2);
    expect(result.current.specRates.tool_read).toBeCloseTo(0.13);
    expect(result.current.specRates.tool_exec).toBeCloseTo(0.13);

    await act(() => vi.advanceTimersByTimeAsync(1_600));
    expect(result.current.specRates.tool_read).toBeCloseTo(0.065);
    expect(result.current.specRates.tool_exec).toBeCloseTo(0.065);
    expect(result.current.eventsPerSec).toBe(0);

    await act(() => vi.advanceTimersByTimeAsync(60_800));
    expect(result.current.eventsPerMin).toBe(0);
    expect(result.current.entries).toEqual([]);
  });

  it('maps non-Claude activity changes to lifecycle-only choreography beats', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-1': agent({
          id: 'agent-pan-1',
          issueId: 'PAN-1',
          runtime: 'codex',
        }),
      },
    });
    const { result } = renderHook(() => useHookStream());

    act(() => {
      useDashboardStore.getState().applyEvents([
        event('agent.activity_changed', {
          agentId: 'agent-pan-1',
          activity: 'working',
          currentTool: 'Bash',
        }, 1),
        event('agent.activity_changed', {
          agentId: 'agent-pan-1',
          activity: 'idle',
        }, 2),
        event('agent.activity_changed', {
          agentId: 'agent-pan-1',
          activity: 'stopped',
        }, 3),
      ]);
    });

    expect(result.current.entries).toMatchObject([
      // A tool-carrying beat without a hookName IS the PostToolUse heartbeat —
      // it must light the named hook channels, not an unnamed lifecycle bucket.
      { sequence: 1, source: 'hook', issueId: 'PAN-1', tool: 'Bash', hookName: 'PostToolUse', family: 'tool_exec' },
      { sequence: 2, source: 'lifecycle', issueId: 'PAN-1', tool: 'idle', hookName: 'Lifecycle', family: 'lifecycle' },
      { sequence: 3, source: 'lifecycle', issueId: 'PAN-1', tool: 'stopped', hookName: 'Lifecycle', family: 'lifecycle' },
    ]);
  });

  it('resolves the first hook event against an agent created in the same batch', () => {
    const { result } = renderHook(() => useHookStream());
    const created = agent({ id: 'agent-pan-1', issueId: 'PAN-1' });

    act(() => {
      useDashboardStore.getState().applyEvents([
        event('agent.created', {
          agentId: created.id,
          issueId: created.issueId,
          agent: created,
        }, 1),
        event('agent.activity_changed', {
          agentId: created.id,
          activity: 'working',
          currentTool: 'Read',
          hookName: 'PreToolUse',
        }, 2),
      ]);
    });

    expect(result.current.entries).toMatchObject([
      { agentId: created.id, issueId: created.issueId, hookName: 'PreToolUse' },
    ]);
  });

  it('maps thinking, waiting, compaction, and cost events into orb micro-state', () => {
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-1': agent({ id: 'agent-pan-1', issueId: 'PAN-1' }),
      },
    });
    const { result } = renderHook(() => useHookStream());

    act(() => {
      useDashboardStore.getState().applyEvents([
        event('agent.thinking_started', { agentId: 'agent-pan-1', lastToolAt: NOW.toISOString() }, 1),
        event('agent.waiting_started', { agentId: 'agent-pan-1', reason: 'tool_permission' }, 2),
        event('agent.context_saturation_changed', {
          agentId: 'agent-pan-1',
          contextSaturatedAt: NOW.toISOString(),
        }, 3),
        event('cost.event_recorded', {
          agentId: 'agent-pan-1',
          issueId: 'PAN-1',
          cost: 0.25,
          inputTokens: 100,
          outputTokens: 25,
        }, 4),
      ]);
    });

    expect(result.current.microStatesByAgentId['agent-pan-1']).toMatchObject({
      thinkUntil: NOW.getTime() + 30 * 60_000,
      waitUntil: NOW.getTime() + 30 * 60_000,
      compactT: 0.9,
      spend: 0.25,
    });
    expect(result.current.costEvents).toMatchObject([{ agentId: 'agent-pan-1', issueId: 'PAN-1', cost: 0.25 }]);
  });
});

describe('useConfluenceData metadata fallback', () => {
  it('returns unavailable beads and cost values without throwing when their sources are absent', () => {
    const client = queryClient();
    client.setQueryData(['agents-fleet-cost-summary'], {});
    client.setQueryData(['conversations'], []);
    const { result } = renderHook(() => useConfluenceData(), { wrapper: wrapper(client) });

    expect(result.current.meta.beads).toBeNull();
    expect(result.current.meta.tokensToday).toBeNull();
    expect(result.current.meta.costPerMin).toBeNull();
    expect(result.current.meta.conversations).toBe(0);
  });
});

describe('useConfluenceOrbs — parked cast (PAN-3490)', () => {
  it('synthesizes a Doldrums orb for a parked issue with no live agent', async () => {
    parkedPayload = {
      rows: [{
        issueId: 'PAN-77',
        orbit: 'stuck-flag',
        parkedAt: new Date(NOW.getTime() - 16 * 60 * 60_000).toISOString(),
        parkReason: 'stuck flag set (feedback_delivery_needs_you)',
        unparkCondition: 'resume the work agent',
      }],
      summary: { total: 1, byOrbit: { 'stuck-flag': 1 }, primaryByIssue: { 'PAN-77': 'stuck-flag' } },
    };
    useDashboardStore.setState({
      issuesRaw: [{ id: 'PAN-77', identifier: 'PAN-77', title: 'Stuck thing', labels: [], state: 'open' }],
    });
    const client = queryClient();
    const { result } = renderHook(() => useConfluenceOrbs(), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const orb = result.current.find((candidate) => candidate.id === 'PAN-77');
    expect(orb).toBeDefined();
    expect(orb?.state).toBe('stale');
    expect(orb?.parkedOrbit).toBe('stuck-flag');
    expect(orb?.orbitReason).toContain('feedback_delivery_needs_you');
    expect(orb?.parkedMin).toBe(16 * 60);
    expect(orb?.title).toBe('Stuck thing');
  });

  it('a live orb on a parked issue carries the orbit without leaving the river', async () => {
    parkedPayload = {
      rows: [{
        issueId: 'PAN-3',
        orbit: 'conflicts',
        parkedAt: new Date(NOW.getTime() - 4 * 60 * 60_000).toISOString(),
        parkReason: 'branch invalidated',
        unparkCondition: 'resolve conflicts',
      }],
      summary: { total: 1, byOrbit: { conflicts: 1 }, primaryByIssue: { 'PAN-3': 'conflicts' } },
    };
    useDashboardStore.setState({
      agentsById: { 'agent-pan-3': agent({ id: 'agent-pan-3', issueId: 'PAN-3' }) },
      issuesRaw: [{ id: 'PAN-3', identifier: 'PAN-3', title: 'Conflicted', labels: [], state: 'open' }],
    });
    const client = queryClient();
    const { result } = renderHook(() => useConfluenceOrbs(), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const orb = result.current.find((candidate) => candidate.id === 'PAN-3');
    expect(orb?.state).toBe('active');
    expect(orb?.parkedOrbit).toBe('conflicts');
    expect(orb?.parkedMin).toBe(240);
  });

  it('closed parked issues never render (residue is not cast)', async () => {
    parkedPayload = {
      rows: [{
        issueId: 'PAN-78',
        orbit: 'stuck-flag',
        parkedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        parkReason: 'stuck',
        unparkCondition: 'unstick',
      }],
      summary: { total: 1, byOrbit: { 'stuck-flag': 1 }, primaryByIssue: { 'PAN-78': 'stuck-flag' } },
    };
    useDashboardStore.setState({
      issuesRaw: [{ id: 'PAN-78', identifier: 'PAN-78', title: 'Done thing', labels: [], state: 'closed' }],
    });
    const client = queryClient();
    const { result } = renderHook(() => useConfluenceOrbs(), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(result.current.find((candidate) => candidate.id === 'PAN-78')).toBeUndefined();
  });
});

describe('event-driven liveness (operator directive: event-based, not polling)', () => {
  it('an agent with a stale snapshot stamp but fresh runtime events is NOT stale', async () => {
    const staleSnap = new Date(NOW.getTime() - 3 * 60 * 60_000).toISOString();
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-5': agent({ id: 'agent-pan-5', issueId: 'PAN-5', lastActivity: staleSnap }),
      },
      agentRuntimeById: {
        // A tool beat 40 seconds ago — the event stream says WORKING.
        'agent-pan-5': { activity: 'working', lastActivity: new Date(NOW.getTime() - 40_000).toISOString(), updatedAtSequence: 99 } as never,
      },
      issuesRaw: [{ id: 'PAN-5', identifier: 'PAN-5', title: 'Live work', labels: [], state: 'open' }],
    });
    const client = queryClient();
    const { result } = renderHook(() => useConfluenceOrbs(), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const orb = result.current.find((candidate) => candidate.id === 'PAN-5');
    expect(orb?.state).toBe('active');
    expect(orb?.idleMin).toBeLessThan(1);
  });

  it('an agent with fresh snapshot stamps but NO runtime events goes stale on evidence', async () => {
    const freshSnap = new Date(NOW.getTime() - 45 * 60_000).toISOString();
    useDashboardStore.setState({
      agentsById: {
        'agent-pan-6': agent({ id: 'agent-pan-6', issueId: 'PAN-6', lastActivity: freshSnap }),
      },
      agentRuntimeById: {},
      issuesRaw: [{ id: 'PAN-6', identifier: 'PAN-6', title: 'Quiet', labels: [], state: 'open' }],
    });
    const client = queryClient();
    const { result } = renderHook(() => useConfluenceOrbs(), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const orb = result.current.find((candidate) => candidate.id === 'PAN-6');
    expect(orb?.state).toBe('stale');
  });
});
