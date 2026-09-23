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
import type { LegacyConversation } from '../../../../../src/lib/overdeck/conversations.js';

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
      { ...deps, readAgentState: () => null, readConversation: () => null },
    );

    expect(result).toEqual({ applied: false, reason: 'no-state' });
  });
});

describe('applyAgentLifecycleEventWithDeps for a supervised conversation (PAN-3962)', () => {
  const at = '2026-09-22T10:05:00.000Z';
  const SESSION = 'conv-20260922-abcd';
  const conversation = {
    name: '20260922-abcd',
    tmuxSession: SESSION,
    cwd: '/tmp/conv-cwd',
    claudeSessionId: 'session-uuid',
    status: 'active',
    endedAt: null,
    clearedToConvId: null,
  } as LegacyConversation;

  function makeConversationDeps(overrides: {
    respawnStartedAt?: (id: string) => number | null;
    conversation?: LegacyConversation;
  } = {}) {
    return {
      readAgentState: () => null,
      readConversation: () => overrides.conversation ?? conversation,
      hasExited: async () => false,
      respawnStartedAt: overrides.respawnStartedAt ?? (() => null),
      markConversationRunning: vi.fn(),
      markConversationEnded: vi.fn(),
      cleanupEndedConversation: vi.fn(async () => undefined),
    };
  }

  it('exited marks the row ended and runs attachment cleanup exactly once', async () => {
    const deps = makeConversationDeps();
    const result = await applyAgentLifecycleEventWithDeps(makeEventStore(), SESSION, { event: 'exited', at }, deps);

    expect(result).toEqual({ applied: true, status: 'stopped' });
    expect(deps.markConversationEnded).toHaveBeenCalledWith(conversation.name, Date.parse(at));
    expect(deps.cleanupEndedConversation).toHaveBeenCalledTimes(1);
    expect(deps.cleanupEndedConversation).toHaveBeenCalledWith(conversation);
  });

  it('a duplicate exited does not run cleanup again', async () => {
    const deps = makeConversationDeps();
    const eventStore = makeEventStore();
    await applyAgentLifecycleEventWithDeps(eventStore, SESSION, { event: 'exited', at }, deps);
    const retry = await applyAgentLifecycleEventWithDeps(eventStore, SESSION, { event: 'exited', at }, deps);

    expect(retry).toEqual({ applied: false, reason: 'duplicate' });
    expect(deps.cleanupEndedConversation).toHaveBeenCalledTimes(1);
  });

  describe('respawn windows and launch generations (F1)', () => {
    const respawnStart = Date.parse('2026-09-22T10:00:00.000Z');
    const inWindow = () => respawnStart;

    it('an exit from a supervisor launched before the respawn began is ignored', async () => {
      const deps = makeConversationDeps({ respawnStartedAt: inWindow });
      const result = await applyAgentLifecycleEventWithDeps(makeEventStore(), SESSION, {
        event: 'exited',
        at: '2026-09-22T10:00:02.000Z',
        launchedAt: '2026-09-22T08:00:00.000Z',
      }, deps);

      expect(result).toEqual({ applied: false, reason: 'respawn-pending' });
      expect(deps.markConversationEnded).not.toHaveBeenCalled();
      expect(deps.cleanupEndedConversation).not.toHaveBeenCalled();
    });

    it('the NEW harness exiting during the respawn window (resume onto a dead model) ends the row', async () => {
      const deps = makeConversationDeps({ respawnStartedAt: inWindow });
      const eventStore = makeEventStore();
      const launchedAt = '2026-09-22T10:00:01.000Z';
      await applyAgentLifecycleEventWithDeps(
        eventStore, SESSION, { event: 'session-started', at: launchedAt, launchedAt }, deps,
      );
      const exitAt = '2026-09-22T10:00:03.000Z';
      const result = await applyAgentLifecycleEventWithDeps(
        eventStore, SESSION, { event: 'exited', at: exitAt, launchedAt, exitCode: 1 }, deps,
      );

      expect(result).toEqual({ applied: true, status: 'stopped' });
      expect(deps.markConversationEnded).toHaveBeenCalledWith(conversation.name, Date.parse(exitAt));
      expect(deps.cleanupEndedConversation).toHaveBeenCalledTimes(1);
    });

    it('a supervisor without launchedAt is dated by its exit time', async () => {
      const deps = makeConversationDeps({ respawnStartedAt: inWindow });
      const before = await applyAgentLifecycleEventWithDeps(
        makeEventStore(), SESSION, { event: 'exited', at: '2026-09-22T09:59:59.000Z' }, deps,
      );
      const after = await applyAgentLifecycleEventWithDeps(
        makeEventStore(), SESSION, { event: 'exited', at: '2026-09-22T10:00:05.000Z' }, deps,
      );

      expect(before).toEqual({ applied: false, reason: 'respawn-pending' });
      expect(after).toEqual({ applied: true, status: 'stopped' });
    });

    it('after the window closes, an exit from a launch older than the newest started one is ignored', async () => {
      const deps = makeConversationDeps();
      const eventStore = makeEventStore();
      const newLaunch = '2026-09-22T10:00:01.000Z';
      await applyAgentLifecycleEventWithDeps(
        eventStore, SESSION, { event: 'session-started', at: newLaunch, launchedAt: newLaunch }, deps,
      );
      const stale = await applyAgentLifecycleEventWithDeps(eventStore, SESSION, {
        event: 'exited',
        at: '2026-09-22T10:00:04.000Z',
        launchedAt: '2026-09-22T08:00:00.000Z',
      }, deps);

      expect(stale).toEqual({ applied: false, reason: 'superseded-launch' });
      expect(deps.markConversationEnded).not.toHaveBeenCalled();
    });

    it('a late exit without launchedAt (pre-deploy supervisor) after a newer launch started is superseded', async () => {
      const deps = makeConversationDeps();
      const eventStore = makeEventStore();
      const newLaunch = '2026-09-22T10:00:01.000Z';
      await applyAgentLifecycleEventWithDeps(
        eventStore, SESSION, { event: 'session-started', at: newLaunch, launchedAt: newLaunch }, deps,
      );
      // The old supervisor's retried exit lands after the respawn window closed,
      // stamped later than the new launch.
      const stale = await applyAgentLifecycleEventWithDeps(eventStore, SESSION, {
        event: 'exited',
        at: '2026-09-22T10:00:20.000Z',
      }, deps);

      expect(stale).toEqual({ applied: false, reason: 'superseded-launch' });
      expect(deps.markConversationEnded).not.toHaveBeenCalled();
      expect(deps.cleanupEndedConversation).not.toHaveBeenCalled();
      expect(eventStore.appended.map((event) => (event['payload'] as { activity: string }).activity)).toEqual(['idle']);
    });
  });

  it('an exit for a row something else already ended records the time but never re-runs cleanup (F3)', async () => {
    const ended = { ...conversation, status: 'ended', endedAt: '2026-09-22T10:04:59.000Z' } as LegacyConversation;
    const deps = makeConversationDeps({ conversation: ended });
    const eventStore = makeEventStore();
    const result = await applyAgentLifecycleEventWithDeps(eventStore, SESSION, { event: 'exited', at }, deps);

    expect(result).toEqual({ applied: true, status: 'stopped' });
    expect(deps.markConversationEnded).toHaveBeenCalledWith(conversation.name, Date.parse(at));
    expect(deps.cleanupEndedConversation).not.toHaveBeenCalled();
    // The read model still learns the harness stopped.
    expect(eventStore.appended.map((event) => (event['payload'] as { activity: string }).activity)).toEqual(['stopped']);
  });

  describe('late session-started (F4)', () => {
    const ended = {
      ...conversation,
      status: 'ended',
      endedAt: '2026-09-22T10:05:00.000Z',
    } as LegacyConversation;

    it('rejects a start older than the row\'s end (retried after the harness exited)', async () => {
      const deps = makeConversationDeps({ conversation: ended });
      const eventStore = makeEventStore();
      const result = await applyAgentLifecycleEventWithDeps(eventStore, SESSION, {
        event: 'session-started',
        at: '2026-09-22T10:04:00.000Z',
      }, deps);

      expect(result).toEqual({ applied: false, reason: 'already-stopped' });
      expect(deps.markConversationRunning).not.toHaveBeenCalled();
      expect(eventStore.append).not.toHaveBeenCalled();
    });

    it('accepts a start newer than the row\'s end (a resume)', async () => {
      const deps = makeConversationDeps({ conversation: ended });
      const result = await applyAgentLifecycleEventWithDeps(makeEventStore(), SESSION, {
        event: 'session-started',
        at: '2026-09-22T10:06:00.000Z',
      }, deps);

      expect(result).toEqual({ applied: true, status: 'running' });
      expect(deps.markConversationRunning).toHaveBeenCalledWith(conversation.name);
    });

    it('does not consult the backend pane inventory, which cannot see conv-* sessions', async () => {
      const deps = { ...makeConversationDeps(), hasExited: vi.fn(async () => true) };
      const result = await applyAgentLifecycleEventWithDeps(makeEventStore(), SESSION, {
        event: 'session-started',
        at,
      }, deps);

      expect(result).toEqual({ applied: true, status: 'running' });
      expect(deps.hasExited).not.toHaveBeenCalled();
    });
  });

  it('never revives a /clear-ended parent (F2)', async () => {
    const parent = {
      ...conversation,
      status: 'ended',
      endedAt: '2026-09-22T09:00:00.000Z',
      clearedToConvId: 42,
    } as LegacyConversation;
    const deps = makeConversationDeps({ conversation: parent });
    const result = await applyAgentLifecycleEventWithDeps(makeEventStore(), SESSION, {
      event: 'session-started',
      at,
    }, deps);

    expect(result).toEqual({ applied: false, reason: 'already-stopped' });
    expect(deps.markConversationRunning).not.toHaveBeenCalled();
  });

  it('a cleanup failure never fails the exit', async () => {
    const deps = makeConversationDeps();
    deps.cleanupEndedConversation.mockRejectedValueOnce(new Error('disk gone'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await applyAgentLifecycleEventWithDeps(makeEventStore(), SESSION, { event: 'exited', at }, deps);
      expect(result).toEqual({ applied: true, status: 'stopped' });
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('turn and start edges never run cleanup', async () => {
    const deps = makeConversationDeps();
    const eventStore = makeEventStore();
    await applyAgentLifecycleEventWithDeps(eventStore, SESSION, { event: 'session-started', at }, deps);
    await applyAgentLifecycleEventWithDeps(eventStore, SESSION, { event: 'turn-started', at }, deps);
    await applyAgentLifecycleEventWithDeps(eventStore, SESSION, { event: 'turn-ended', at }, deps);

    expect(deps.markConversationRunning).toHaveBeenCalledWith(conversation.name);
    expect(deps.cleanupEndedConversation).not.toHaveBeenCalled();
  });
});
