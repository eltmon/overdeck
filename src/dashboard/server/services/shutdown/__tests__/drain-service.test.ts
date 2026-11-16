/**
 * PAN-5342 WI-5: the drain service. Every dep is a fake (no real stops,
 * spawns, git or record file); ticks run on fake timers.
 */
import type { AgentRuntimeSnapshot, ShutdownWriter } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShutdownRecord } from '../../../../../lib/shutdown/drain-record.js';
import {
  DRAIN_TICK_MS,
  STOP_RETRY_MS,
  _resetShutdownForTests,
  _setDrainDepsForTests,
  cancelShutdown,
  forceAll,
  forceStopSession,
  getShutdownSnapshot,
  shouldStopNow,
  startShutdown,
  type DrainDeps,
} from '../drain-service.js';
import { getShutdownPreview, listLiveSessionIds } from '../preview.js';

interface FakeSession { boundary: boolean; live: boolean; stopKills: boolean }

function harness(initial: Record<string, Partial<FakeSession>>) {
  const sessions = new Map<string, FakeSession>(
    Object.entries(initial).map(([id, s]) => [id, { boundary: true, live: true, stopKills: true, ...s }]),
  );
  const state = {
    record: null as ShutdownRecord | null,
    writers: [] as ShutdownWriter[],
    inventoryNull: false,
    holder: null as { pid: number } | null,
  };
  const kill = (id: string) => {
    const s = sessions.get(id);
    if (s?.stopKills) s.live = false;
  };
  const deps: DrainDeps = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    atTurnBoundary: (id) => sessions.get(id)?.boundary ?? false,
    isConfirmedStopped: async (id) => !(sessions.get(id)?.live ?? false),
    listLiveSessionIds: async () =>
      state.inventoryNull ? null : new Set([...sessions].filter(([, s]) => s.live).map(([id]) => id)),
    runtime: (id) => ({
      activity: sessions.get(id)?.boundary ? 'idle' : 'working',
      lastActivity: new Date().toISOString(),
      ...(sessions.get(id)?.boundary ? {} : { currentTool: 'Bash', currentToolDescription: 'npm test' }),
    }) as unknown as AgentRuntimeSnapshot,
    describeSession: async (id) =>
      id.startsWith('conv-')
        ? { kind: 'conversation', label: `Conversation ${id.slice(5)}`, conversationName: id.slice(5) }
        : { kind: 'agent', label: `PAN-1 work agent ${id}`, issueId: 'PAN-1' },
    stopAgent: vi.fn(async (id: string) => kill(id)),
    stopConversation: vi.fn(async (name: string) => kill(`conv-${name}`)),
    listWriters: vi.fn(async () => state.writers),
    verifyQuiet: vi.fn(async () => []),
    spawnFinalStage: vi.fn(async () => undefined),
    emit: vi.fn(),
    releaseRebootGuard: vi.fn(),
    seedResumeOffer: vi.fn(),
    readRestartLockHolder: vi.fn(async () => state.holder),
    readRecord: async () => (state.record ? structuredClone(state.record) : null),
    writeRecord: async (r) => { state.record = structuredClone(r); },
    deleteRecord: async () => { state.record = null; },
  };
  _setDrainDepsForTests(deps);
  return { sessions, state, deps };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const opts = (o: Partial<{ deadlineSeconds: number; reboot: boolean; force: boolean }> = {}) =>
  ({ deadlineSeconds: 120, reboot: false, force: false, ...o });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
});

afterEach(() => {
  _resetShutdownForTests();
  vi.useRealTimers();
});

describe('shouldStopNow (D-4)', () => {
  it('stops at a turn boundary or under force only', () => {
    expect(shouldStopNow(true, false)).toBe(true);
    expect(shouldStopNow(false, true)).toBe(true);
    expect(shouldStopNow(false, false)).toBe(false);
  });
});

describe('drain service (PAN-5342 WI-5)', () => {
  it('1. stops an idle session on the first tick and leaves a working one pending', async () => {
    const h = harness({ 'agent-a': { boundary: true }, 'agent-b': { boundary: false } });
    const started = await startShutdown(opts());
    expect(started.started).toBe(true);
    expect(h.state.record?.phase).toBe('draining');
    await flush();
    expect(h.deps.stopAgent).toHaveBeenCalledWith('agent-a');
    expect(h.deps.stopAgent).not.toHaveBeenCalledWith('agent-b');
    expect(h.state.record?.stopped.map((s) => s.id)).toEqual(['agent-a']);
    const snap = getShutdownSnapshot();
    expect(snap?.pending.map((p) => p.id)).toEqual(['agent-b']);
    expect(snap?.pending[0]).toMatchObject({ activity: 'working', tool: 'Bash', toolDescription: 'npm test', label: 'PAN-1 work agent agent-b' });
    expect(snap?.stoppedCount).toBe(1);
  });

  it('2. a working session that turns idle is stopped on the next tick', async () => {
    const h = harness({ 'agent-b': { boundary: false } });
    await startShutdown(opts());
    await flush();
    expect(h.deps.stopAgent).not.toHaveBeenCalled();
    h.sessions.get('agent-b')!.boundary = true;
    await vi.advanceTimersByTimeAsync(DRAIN_TICK_MS);
    expect(h.deps.stopAgent).toHaveBeenCalledWith('agent-b');
    expect(h.state.record?.stopped).toEqual([
      expect.objectContaining({ kind: 'agent', id: 'agent-b', issueId: 'PAN-1', wasWorking: true }),
    ]);
  });

  it('3. without force, past the deadline, nothing is stopped and overdue is true', async () => {
    const h = harness({ 'agent-b': { boundary: false } });
    await startShutdown(opts({ deadlineSeconds: 10 }));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(h.deps.stopAgent).not.toHaveBeenCalled();
    expect(getShutdownSnapshot()).toMatchObject({ phase: 'draining', overdue: true, force: 'never' });
    expect(h.deps.spawnFinalStage).not.toHaveBeenCalled();
  });

  it('4. with force at the deadline the pending session is stopped and writers are not awaited', async () => {
    const h = harness({ 'agent-b': { boundary: false } });
    h.state.writers = [{ kind: 'auto-merge', label: 'Merging PAN-9' }];
    await startShutdown(opts({ deadlineSeconds: 10, force: true }));
    await vi.advanceTimersByTimeAsync(8_000);
    expect(h.deps.stopAgent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.deps.stopAgent).toHaveBeenCalledWith('agent-b');
    expect(getShutdownSnapshot()?.phase).toBe('complete');
    expect(h.deps.spawnFinalStage).toHaveBeenCalledTimes(1);
  });

  it('5. forceAll stops every pending session at the next tick', async () => {
    const h = harness({ 'agent-b': { boundary: false }, 'conv-x': { boundary: false } });
    await startShutdown(opts());
    await flush();
    expect(await forceAll()).toBe(true);
    expect(h.state.record?.force).toBe('now');
    await flush();
    expect(h.deps.stopAgent).toHaveBeenCalledWith('agent-b');
    expect(h.deps.stopConversation).toHaveBeenCalledWith('x');
    expect(getShutdownSnapshot()?.phase).toBe('complete');
  });

  it('6. a pending writer holds waiting-for-writers; complete then launches the final stage once', async () => {
    const h = harness({ 'agent-a': { boundary: true } });
    h.state.writers = [{ kind: 'verification', label: 'Verification for PAN-3', startedAt: '2026-11-15T11:59:00Z' }];
    await startShutdown(opts({ reboot: true }));
    await vi.advanceTimersByTimeAsync(3 * DRAIN_TICK_MS);
    expect(getShutdownSnapshot()).toMatchObject({ phase: 'waiting-for-writers', writers: h.state.writers });
    expect(h.deps.spawnFinalStage).not.toHaveBeenCalled();
    h.state.writers = [];
    await vi.advanceTimersByTimeAsync(DRAIN_TICK_MS);
    expect(getShutdownSnapshot()?.phase).toBe('complete');
    expect(h.state.record?.phase).toBe('complete');
    expect(h.deps.verifyQuiet).toHaveBeenCalledTimes(1);
    expect(h.deps.releaseRebootGuard).toHaveBeenCalledTimes(1);
    expect(h.deps.spawnFinalStage).toHaveBeenCalledWith({ reboot: true });
    await vi.advanceTimersByTimeAsync(5 * DRAIN_TICK_MS);
    expect(h.deps.spawnFinalStage).toHaveBeenCalledTimes(1);
    expect(await cancelShutdown()).toBe('complete');
  });

  it('7. cancel deletes the record and offers agents plus mid-turn conversations only', async () => {
    const h = harness({
      'agent-a': { boundary: true },
      'conv-idle': { boundary: true },
      'conv-busy': { boundary: false },
      'agent-b': { boundary: false },
    });
    await startShutdown(opts());
    await flush();
    h.sessions.get('conv-busy')!.boundary = true;
    await vi.advanceTimersByTimeAsync(DRAIN_TICK_MS);
    expect(h.state.record?.stopped.map((s) => s.id).sort()).toEqual(['agent-a', 'conv-busy', 'conv-idle']);
    expect(await cancelShutdown()).toBe('cancelled');
    expect(h.state.record).toBeNull();
    const offered = vi.mocked(h.deps.seedResumeOffer).mock.calls[0]![0];
    expect(offered.map((s) => s.id).sort()).toEqual(['agent-a', 'conv-busy']);
    expect(offered.find((s) => s.id === 'conv-busy')).toMatchObject({ kind: 'conversation', name: 'busy', wasWorking: true });
    expect(getShutdownSnapshot()).toBeNull();
    expect(vi.mocked(h.deps.emit).mock.calls.at(-1)![0]).toBeNull();
    // The loop is over: no later tick writes the record back.
    h.sessions.get('agent-b')!.boundary = true;
    await vi.advanceTimersByTimeAsync(5 * DRAIN_TICK_MS);
    expect(h.state.record).toBeNull();
    expect(h.deps.stopAgent).not.toHaveBeenCalledWith('agent-b');
  });

  it('8. refuses with restart-in-progress while a reload or restart holds the lock', async () => {
    const h = harness({ 'agent-a': {} });
    h.state.holder = { pid: 4242 };
    expect(await startShutdown(opts())).toEqual({ started: false, reason: 'restart-in-progress', pid: 4242 });
    expect(h.state.record).toBeNull();
    expect(getShutdownSnapshot()).toBeNull();
  });

  it('refuses a second start while a drain runs or a record exists', async () => {
    harness({ 'agent-b': { boundary: false } });
    await startShutdown(opts());
    expect(await startShutdown(opts())).toEqual({ started: false, reason: 'already-running' });
  });

  it('9. an unreadable inventory stops nothing', async () => {
    const h = harness({ 'agent-a': { boundary: true } });
    h.state.inventoryNull = true;
    await startShutdown(opts({ force: true, deadlineSeconds: 10 }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.deps.stopAgent).not.toHaveBeenCalled();
    expect(getShutdownSnapshot()?.warnings).toContain('The terminal backend did not answer; no session was stopped this tick');
    expect(getShutdownSnapshot()?.phase).toBe('draining');
  });

  it('10. a surviving pane stays pending, is retried only after 10 s, and is recorded once', async () => {
    const h = harness({ 'agent-a': { boundary: true, stopKills: false }, 'agent-b': { boundary: false } });
    await startShutdown(opts());
    await flush();
    expect(h.deps.stopAgent).toHaveBeenCalledTimes(1);
    expect(h.state.record?.stopped).toEqual([]);
    expect(getShutdownSnapshot()?.warnings).toContain('agent-a: stop attempted, pane still live');
    expect(getShutdownSnapshot()?.pending.map((p) => p.id).sort()).toEqual(['agent-a', 'agent-b']);
    await vi.advanceTimersByTimeAsync(STOP_RETRY_MS - DRAIN_TICK_MS);
    expect(h.deps.stopAgent).toHaveBeenCalledTimes(1);
    h.sessions.get('agent-a')!.stopKills = true;
    await vi.advanceTimersByTimeAsync(DRAIN_TICK_MS);
    expect(h.deps.stopAgent).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3 * DRAIN_TICK_MS);
    expect(h.state.record?.stopped.map((s) => s.id)).toEqual(['agent-a']);
    expect(getShutdownSnapshot()?.warnings).not.toContain('agent-a: stop attempted, pane still live');
  });

  it('forceStopSession stops one pending session now and refuses ids that are not pending', async () => {
    const h = harness({ 'agent-b': { boundary: false }, 'agent-c': { boundary: false } });
    expect(await forceStopSession('agent-b')).toBe(false);
    await startShutdown(opts());
    await flush();
    expect(await forceStopSession('agent-zzz')).toBe(false);
    expect(await forceStopSession('agent-b')).toBe(true);
    expect(h.deps.stopAgent).toHaveBeenCalledWith('agent-b');
    expect(getShutdownSnapshot()?.pending.map((p) => p.id)).toEqual(['agent-c']);
    expect(h.state.record?.stopped.map((s) => s.id)).toEqual(['agent-b']);
  });

  it('forceAll answers false and cancel answers not-running when no drain runs', async () => {
    harness({});
    expect(await forceAll()).toBe(false);
    expect(await cancelShutdown()).toBe('not-running');
  });
});

describe('session census (PAN-5342, epic-owner correction)', () => {
  it('unions the agent inventory and the conversation sessions, counting a shared id once', async () => {
    const ids = await listLiveSessionIds({
      listLiveAgentIds: async () => new Set(['agent-pan-1', 'conv-a']),
      listLiveConversationSessions: async () => new Set(['conv-a', 'conv-b', 'agent-legacy-tmux']),
    });
    expect([...(ids ?? [])].sort()).toEqual(['agent-legacy-tmux', 'agent-pan-1', 'conv-a', 'conv-b']);
  });

  it('is null when either source is unreadable', async () => {
    const live = async () => new Set(['agent-pan-1']);
    expect(await listLiveSessionIds({ listLiveAgentIds: async () => null, listLiveConversationSessions: live })).toBeNull();
    expect(await listLiveSessionIds({ listLiveAgentIds: live, listLiveConversationSessions: async () => null })).toBeNull();
  });

  it('previews agents, conversations, mid-turn sessions, writers and a restart holder', async () => {
    const writers: ShutdownWriter[] = [{ kind: 'post-merge', label: 'Post-merge work for PAN-2' }];
    expect(await getShutdownPreview({
      listLiveSessionIds: async () => new Set(['agent-a', 'agent-b', 'conv-x']),
      atTurnBoundary: (id) => id !== 'agent-b',
      listWriters: async () => writers,
      readRestartLockHolder: async () => ({ pid: 77 }),
    })).toEqual({ agents: 2, conversations: 1, workingNow: 1, writers, restartInProgress: { pid: 77 } });
  });
});
