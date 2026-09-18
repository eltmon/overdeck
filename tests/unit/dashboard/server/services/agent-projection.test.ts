/**
 * Agent lifecycle projection (PAN-3917 W6).
 *
 * The projection used to commit an agents-row upsert and an event append in
 * one SQLite transaction, so the mirror and the event could not drift. There is
 * no mirror any more: the module appends the event and nothing else, and
 * liveness is read from the terminal backend. These tests cover what is left —
 * the append, and the supervisor-retry dedupe that used to be answered by
 * comparing `stoppedAt` on the mirror.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentState } from '../../../../../src/lib/agents.js';

vi.mock('../../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycleSync: vi.fn(),
}));

import {
  _resetAgentLifecycleDedupeForTests,
  applyAgentLifecycleEventWithDeps,
  saveAgentStateAndEmitEventWithDeps,
} from '../../../../../src/dashboard/server/services/agent-projection.js';

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1908',
    issueId: 'PAN-1908',
    workspace: '/tmp/ws',
    role: 'work',
    harness: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-06-15T10:00:00.000Z',
    ...overrides,
  } as AgentState;
}

function makeEventStore() {
  let next = 1;
  const appended: Array<Record<string, unknown>> = [];
  return {
    appended,
    append: vi.fn((event: Record<string, unknown>) => {
      appended.push(event);
      return next++;
    }),
  };
}

beforeEach(() => {
  _resetAgentLifecycleDedupeForTests();
  vi.clearAllMocks();
});

describe('saveAgentStateAndEmitEventWithDeps', () => {
  it('appends the event and returns its sequence', () => {
    const eventStore = makeEventStore();
    const event = {
      type: 'agent.started',
      timestamp: '2026-06-15T10:00:00.000Z',
      payload: { agentId: 'agent-pan-1908', issueId: 'PAN-1908' },
    };

    const result = saveAgentStateAndEmitEventWithDeps(eventStore, makeAgentState(), event as never);

    expect(result.sequence).toBe(1);
    expect(eventStore.append).toHaveBeenCalledTimes(1);
    expect(eventStore.appended[0]).toBe(event);
  });

  it('writes nothing but the event — no state is persisted anywhere', () => {
    const eventStore = makeEventStore();
    saveAgentStateAndEmitEventWithDeps(eventStore, makeAgentState({ status: 'stopped' }), {
      type: 'agent.stopped',
      timestamp: '2026-06-15T10:01:00.000Z',
      payload: { agentId: 'agent-pan-1908' },
    } as never);

    expect(eventStore.append).toHaveBeenCalledTimes(1);
  });
});

describe('applyAgentLifecycleEventWithDeps', () => {
  const at = '2026-06-15T10:05:00.000Z';
  const deps = {
    readAgentState: () => makeAgentState(),
    hasExited: async () => false,
  };

  it('emits agent.started for session-started', async () => {
    const eventStore = makeEventStore();
    const result = await applyAgentLifecycleEventWithDeps(eventStore, 'agent-pan-1908', { event: 'session-started', at }, deps);

    expect(result).toEqual({ applied: true, status: 'running' });
    expect(eventStore.appended[0]?.['type']).toBe('agent.started');
  });

  it('emits agent.stopped for exited', async () => {
    const eventStore = makeEventStore();
    const result = await applyAgentLifecycleEventWithDeps(eventStore, 'agent-pan-1908', { event: 'exited', at }, deps);

    expect(result).toEqual({ applied: true, status: 'stopped' });
    expect(eventStore.appended[0]?.['type']).toBe('agent.stopped');
  });

  it('emits agent.activity_changed for turn boundaries', async () => {
    const eventStore = makeEventStore();
    await applyAgentLifecycleEventWithDeps(eventStore, 'agent-pan-1908', { event: 'turn-started', at }, deps);
    await applyAgentLifecycleEventWithDeps(eventStore, 'agent-pan-1908', { event: 'turn-ended', at }, deps);

    expect(eventStore.appended.map((e) => (e['payload'] as { activity: string }).activity)).toEqual(['working', 'idle']);
  });

  it('drops a supervisor retry carrying the same event and timestamp', async () => {
    const eventStore = makeEventStore();
    const first = await applyAgentLifecycleEventWithDeps(eventStore, 'agent-pan-1908', { event: 'exited', at }, deps);
    const retry = await applyAgentLifecycleEventWithDeps(eventStore, 'agent-pan-1908', { event: 'exited', at }, deps);

    expect(first).toEqual({ applied: true, status: 'stopped' });
    expect(retry).toEqual({ applied: false, reason: 'duplicate' });
    expect(eventStore.append).toHaveBeenCalledTimes(1);
  });

  it('applies a second exit that carries a different timestamp', async () => {
    const eventStore = makeEventStore();
    await applyAgentLifecycleEventWithDeps(eventStore, 'agent-pan-1908', { event: 'exited', at }, deps);
    const second = await applyAgentLifecycleEventWithDeps(
      eventStore,
      'agent-pan-1908',
      { event: 'exited', at: '2026-06-15T10:06:00.000Z' },
      deps,
    );

    expect(second).toEqual({ applied: true, status: 'stopped' });
    expect(eventStore.append).toHaveBeenCalledTimes(2);
  });

  it('refuses to resurrect an agent whose pane the backend reports exited', async () => {
    const eventStore = makeEventStore();
    const result = await applyAgentLifecycleEventWithDeps(
      eventStore,
      'agent-pan-1908',
      { event: 'session-started', at },
      { ...deps, hasExited: async () => true },
    );

    expect(result).toEqual({ applied: false, reason: 'already-stopped' });
    expect(eventStore.append).not.toHaveBeenCalled();
  });

  it('reports no-state when the agent has no permanent record', async () => {
    const eventStore = makeEventStore();
    const result = await applyAgentLifecycleEventWithDeps(
      eventStore,
      'agent-missing',
      { event: 'exited', at },
      { ...deps, readAgentState: () => null },
    );

    expect(result).toEqual({ applied: false, reason: 'no-state' });
  });
});
