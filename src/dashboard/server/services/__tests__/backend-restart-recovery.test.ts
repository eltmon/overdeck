/**
 * PAN-5091: the terminal-backend restart recovery offer. The snapshot of live
 * conversations at the loss, the settle at the restore, the skip rules, and
 * Resume all (one at a time, waiting under memory pressure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryPressureBand } from '../../../../lib/cloister/memory-governor.js';
import {
  MEMORY_WAIT_MS,
  RESTART_EXIT_WINDOW_MS,
  _resetBackendRestartRecoveryForTests,
  dismissBackendRestartRecovery,
  getBackendRestartRecoverySnapshot,
  noteBackendLost,
  noteBackendRestored,
  startBackendRestartRecovery,
  startBackendRestartResumeAll,
  type BackendRestartRecoveryDeps,
  type RecoveryConversationRow,
} from '../backend-restart-recovery.js';

const NOW = Date.parse('2026-11-06T09:13:00.000Z');

function row(name: string, overrides: Partial<RecoveryConversationRow> = {}): RecoveryConversationRow {
  return {
    name,
    tmuxSession: `conv-${name}`,
    title: `Title ${name}`,
    status: 'active',
    endedAt: null,
    archivedAt: null,
    origin: 'local',
    releasedTo: null,
    ...overrides,
  };
}

interface World {
  rows: Map<string, RecoveryConversationRow>;
  live: Set<string> | null;
  paused: Set<string>;
  held: Set<string>;
  stopped: Map<string, number>;
  bands: MemoryPressureBand[];
  resumed: string[];
  deps: BackendRestartRecoveryDeps;
}

function world(rows: RecoveryConversationRow[]): World {
  const w = {
    rows: new Map(rows.map((r) => [r.name, r])),
    live: new Set<string>(),
    paused: new Set<string>(),
    held: new Set<string>(),
    stopped: new Map<string, number>(),
    bands: [] as MemoryPressureBand[],
    resumed: [] as string[],
  } as World;
  w.deps = {
    listConversations: () => [...w.rows.values()],
    getConversation: (name) => w.rows.get(name) ?? null,
    liveSessions: async () => (w.live ? new Set(w.live) : null),
    isPaused: (session) => w.paused.has(session),
    isHeld: (name) => w.held.has(name),
    stoppedSince: (name, since) => (w.stopped.get(name) ?? -Infinity) >= since,
    memoryBand: async () => w.bands.shift() ?? 'ok',
    resume: async (name) => {
      w.resumed.push(name);
      const r = w.rows.get(name);
      if (r) w.live?.add(r.tmuxSession);
      return { status: 200, body: { name, status: 'active', reattached: false } };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
  return w;
}

/** The backend goes down and comes back; every recorded conversation's harness is gone. */
async function restart(w: World): Promise<void> {
  noteBackendLost();
  w.live = new Set();
  noteBackendRestored();
  await vi.advanceTimersByTimeAsync(0);
}

async function offeredNames(): Promise<string[]> {
  return (await getBackendRestartRecoverySnapshot()).conversations.map((c) => c.name);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  _resetBackendRestartRecoveryForTests();
});

afterEach(() => {
  _resetBackendRestartRecoveryForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the snapshot of live conversations at the restart', () => {
  it('records active conv- rows and rows ended within the window, and offers those the restart left stopped', async () => {
    const w = world([
      row('a'),
      row('b', { status: 'ended', endedAt: new Date(NOW - 5_000).toISOString() }),
      row('old', { status: 'ended', endedAt: new Date(NOW - RESTART_EXIT_WINDOW_MS - 1).toISOString() }),
      row('agent-pan-1', { tmuxSession: 'agent-pan-1' }),
      row('gone', { archivedAt: new Date(NOW - 1).toISOString() }),
    ]);
    startBackendRestartRecovery(w.deps);
    await restart(w);

    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot.conversations).toEqual([{ name: 'a', title: 'Title a' }, { name: 'b', title: 'Title b' }]);
    expect(snapshot.lostAt).toBe(new Date(NOW).toISOString());
    expect(snapshot.run).toBeNull();
  });

  it('offers nothing while the backend is still down', async () => {
    const w = world([row('a')]);
    startBackendRestartRecovery(w.deps);
    noteBackendLost();
    expect(await offeredNames()).toEqual([]);
    noteBackendRestored();
    w.live = new Set();
    expect(await offeredNames()).toEqual(['a']);
  });

  it('a stream blip that leaves every conversation live offers nothing, and a later death is never offered', async () => {
    const w = world([row('a'), row('b')]);
    w.live = new Set(['conv-a', 'conv-b']);
    startBackendRestartRecovery(w.deps);
    noteBackendLost();
    noteBackendRestored();
    await vi.advanceTimersByTimeAsync(0);
    expect(await offeredNames()).toEqual([]);

    w.live.delete('conv-a');
    expect(await offeredNames()).toEqual([]);
  });

  it('waits to settle until the backend answers the liveness read', async () => {
    const w = world([row('a')]);
    startBackendRestartRecovery(w.deps);
    noteBackendLost();
    w.live = null;
    noteBackendRestored();
    await vi.advanceTimersByTimeAsync(0);
    expect(await offeredNames()).toEqual([]);
    w.live = new Set();
    expect(await offeredNames()).toEqual(['a']);
  });

  it('a second loss before the operator acts joins one offer', async () => {
    const w = world([row('a')]);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    w.rows.set('b', row('b'));
    await restart(w);
    expect(await offeredNames()).toEqual(['a', 'b']);
  });
});

describe('the offer leaves out what Resume all must not resume', () => {
  it('drops resumed, archived and stopped-on-purpose conversations, and hides paused and held ones', async () => {
    const w = world(['live', 'archived', 'stopped', 'paused', 'held', 'released', 'ok'].map((name) => row(name)));
    startBackendRestartRecovery(w.deps);
    await restart(w);
    expect(await offeredNames()).toHaveLength(7);

    w.live!.add('conv-live');
    w.rows.set('archived', row('archived', { archivedAt: new Date().toISOString() }));
    w.stopped.set('stopped', Date.now());
    w.paused.add('conv-paused');
    w.held.add('held');
    w.rows.set('released', row('released', { releasedTo: 'env-desk' }));
    expect(await offeredNames()).toEqual(['ok']);

    // Paused and held come back when lifted; dropped ones never do.
    w.paused.clear();
    w.held.clear();
    w.live!.delete('conv-live');
    expect(await offeredNames()).toEqual(['paused', 'held', 'ok']);
  });

  it('a stop recorded just before the loss still counts as on purpose', async () => {
    const w = world([row('a', { status: 'ended', endedAt: new Date(NOW - 2_000).toISOString() })]);
    w.stopped.set('a', NOW - 2_000);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    expect(await offeredNames()).toEqual([]);
  });

  it('dismiss drops the offer', async () => {
    const w = world([row('a')]);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    expect(dismissBackendRestartRecovery()).toBe(true);
    expect(await getBackendRestartRecoverySnapshot()).toEqual({ lostAt: null, conversations: [], run: null });
  });
});

describe('Resume all', () => {
  it('resumes one conversation at a time through the resume door, then clears the offer', async () => {
    const w = world([row('a'), row('b'), row('c')]);
    let inFlight = 0;
    let maxInFlight = 0;
    const resume = w.deps.resume;
    w.deps.resume = async (name) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      inFlight--;
      return resume(name);
    };
    startBackendRestartRecovery(w.deps);
    await restart(w);

    expect(await startBackendRestartResumeAll()).toEqual({ started: true, conversations: 3 });
    expect(await startBackendRestartResumeAll()).toEqual({ started: false, reason: 'running' });
    expect(dismissBackendRestartRecovery()).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(w.resumed).toEqual(['a', 'b', 'c']);
    expect(maxInFlight).toBe(1);
    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot.conversations).toEqual([]);
    expect(snapshot.run?.state).toBe('done');
    expect(snapshot.run?.results.map((r) => r.outcome)).toEqual(['resumed', 'resumed', 'resumed']);
    expect(await startBackendRestartResumeAll()).toEqual({ started: false, reason: 'nothing-to-resume' });
  });

  it('skips a paused conversation, even one paused after Resume all started', async () => {
    const w = world([row('a'), row('b'), row('c')]);
    w.paused.add('conv-a');
    w.bands = ['hard'];
    startBackendRestartRecovery(w.deps);
    await restart(w);

    expect(await startBackendRestartResumeAll()).toEqual({ started: true, conversations: 2 });
    // Paused while the run waits for memory: re-checked before its resume.
    w.paused.add('conv-b');
    await vi.advanceTimersByTimeAsync(MEMORY_WAIT_MS);

    expect(w.resumed).toEqual(['c']);
    const results = (await getBackendRestartRecoverySnapshot()).run?.results;
    expect(results).toEqual([
      { name: 'b', outcome: 'skipped', reason: 'paused' },
      { name: 'c', outcome: 'resumed' },
    ]);
  });

  it('waits while memory pressure is high before each resume', async () => {
    const w = world([row('a'), row('b')]);
    w.bands = ['hard', 'soft', 'ok', 'hard', 'ok'];
    startBackendRestartRecovery(w.deps);
    await restart(w);

    await startBackendRestartResumeAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.resumed).toEqual([]);
    expect((await getBackendRestartRecoverySnapshot()).run).toMatchObject({ state: 'running', waitingForMemory: true });

    await vi.advanceTimersByTimeAsync(MEMORY_WAIT_MS);
    expect(w.resumed).toEqual([]);
    await vi.advanceTimersByTimeAsync(MEMORY_WAIT_MS);
    expect(w.resumed).toEqual(['a']);
    expect((await getBackendRestartRecoverySnapshot()).run).toMatchObject({ waitingForMemory: true });

    await vi.advanceTimersByTimeAsync(MEMORY_WAIT_MS);
    expect(w.resumed).toEqual(['a', 'b']);
    expect((await getBackendRestartRecoverySnapshot()).run).toMatchObject({ state: 'done', waitingForMemory: false });
  });

  it('reports a refused resume as failed and keeps that conversation offered', async () => {
    const w = world([row('a'), row('b')]);
    const resume = w.deps.resume;
    w.deps.resume = async (name) => (name === 'a'
      ? { status: 409, body: { error: 'Continued on desk; this copy is read-only' } }
      : resume(name));
    startBackendRestartRecovery(w.deps);
    await restart(w);

    await startBackendRestartResumeAll();
    await vi.advanceTimersByTimeAsync(0);

    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot.run?.results).toEqual([
      { name: 'a', outcome: 'failed', reason: 'Continued on desk; this copy is read-only' },
      { name: 'b', outcome: 'resumed' },
    ]);
    expect(snapshot.conversations.map((c) => c.name)).toEqual(['a']);
  });

  it('never resumes anything on its own', async () => {
    const w = world([row('a')]);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    await vi.advanceTimersByTimeAsync(10 * MEMORY_WAIT_MS);
    expect(w.resumed).toEqual([]);
    expect(await offeredNames()).toEqual(['a']);
  });
});
