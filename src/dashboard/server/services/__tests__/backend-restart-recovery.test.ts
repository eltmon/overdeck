/**
 * PAN-5091: the terminal-backend restart recovery offer. The snapshot of live
 * conversations at the loss, the settle at the restore, the skip rules, and
 * Resume all (one at a time, waiting under memory pressure). PAN-5342: the
 * offer a safe shutdown seeds, with agents resumed after the conversations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryPressureBand } from '../../../../lib/cloister/memory-governor.js';
import {
  PRESSURE_WAIT_MS,
  RESTART_EXIT_WINDOW_MS,
  _resetBackendRestartRecoveryForTests,
  dismissBackendRestartRecovery,
  getBackendRestartRecoverySnapshot,
  noteBackendLost,
  noteBackendRestored,
  startBackendRestartRecovery,
  startBackendRestartResumeAll,
  seedShutdownOffer,
  type BackendRestartRecoveryDeps,
  type RecoveryConversationRow,
} from '../backend-restart-recovery.js';
import type { ResumeCause } from '../../../../lib/resume-contract.js';
import type { ShutdownStoppedSession } from '../../../../lib/shutdown/drain-record.js';

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
  causes: ResumeCause[];
  /** Agents with a state file; `liveAgents` null means the inventory did not answer. */
  agentStates: Set<string>;
  liveAgents: Set<string> | null;
  resumedAgents: Array<{ id: string; message: string | undefined; resumeCause: ResumeCause }>;
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
    causes: [] as ResumeCause[],
    agentStates: new Set<string>(),
    liveAgents: new Set<string>(),
    resumedAgents: [] as World['resumedAgents'],
  } as World;
  w.deps = {
    listConversations: () => [...w.rows.values()],
    getConversation: (name) => w.rows.get(name) ?? null,
    liveSessions: async () => (w.live ? new Set(w.live) : null),
    isPaused: (session) => w.paused.has(session),
    isHeld: (name) => w.held.has(name),
    stoppedSince: (name, since) => (w.stopped.get(name) ?? -Infinity) >= since,
    pressureBand: async () => w.bands.shift() ?? 'ok',
    resume: async (name, cause) => {
      w.resumed.push(name);
      w.causes.push(cause);
      const r = w.rows.get(name);
      if (r) w.live?.add(r.tmuxSession);
      return { status: 200, body: { name, status: 'active', reattached: false } };
    },
    liveAgentIds: async () => (w.liveAgents ? new Set(w.liveAgents) : null),
    hasAgentState: (id) => w.agentStates.has(id),
    resumeAgent: async (id, message, opts) => {
      w.resumedAgents.push({ id, message, resumeCause: opts.resumeCause });
      w.liveAgents?.add(id);
      return { success: true };
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

describe('a second restart is a new incident', () => {
  it('offers a conversation resumed after the first restart when a second restart stops it again', async () => {
    const w = world([row('a'), row('p')]);
    // A resume marks the row active again, as handleConversationResume does.
    const resume = w.deps.resume;
    w.deps.resume = async (name, cause) => {
      w.rows.set(name, row(name));
      return resume(name, cause);
    };
    startBackendRestartRecovery(w.deps);
    await restart(w);
    // The lifecycle poll ends both rows; the operator pauses p and resumes the rest.
    w.rows.set('a', row('a', { status: 'ended', endedAt: new Date(NOW + 10_000).toISOString() }));
    w.rows.set('p', row('p', { status: 'ended', endedAt: new Date(NOW + 10_000).toISOString() }));
    w.paused.add('conv-p');
    expect(await offeredNames()).toEqual(['a']);
    await startBackendRestartResumeAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.resumed).toEqual(['a']);

    // An hour later the backend restarts again; the poll ends `a` with a new ended_at.
    vi.setSystemTime(NOW + 60 * 60_000);
    await restart(w);
    w.rows.set('a', row('a', { status: 'ended', endedAt: new Date(NOW + 60 * 60_000 + 10_000).toISOString() }));
    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot.conversations.map((c) => c.name)).toEqual(['a']);
    expect(snapshot.lostAt).toBe(new Date(NOW + 60 * 60_000).toISOString());
    // The first incident's run summary is gone.
    expect(snapshot.run).toBeNull();
  });
});

describe('the offer leaves out what Resume all must not resume', () => {
  it('drops resumed, archived, released, paused, held and stopped-on-purpose conversations for good', async () => {
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

    // Lifting the pause or the hold does not bring them back: no invisible offer lingers.
    w.paused.clear();
    w.held.clear();
    w.live!.delete('conv-live');
    expect(await offeredNames()).toEqual(['ok']);
  });

  it('a stop recorded just before the loss still counts as on purpose', async () => {
    const w = world([row('a', { status: 'ended', endedAt: new Date(NOW - 2_000).toISOString() })]);
    w.stopped.set('a', NOW - 2_000);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    expect(await offeredNames()).toEqual([]);
  });

  it('a row ended again after the offer saw it ended counts as stopped on purpose (a stop from another process)', async () => {
    const w = world([row('a'), row('b')]);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    // The lifecycle poll ends both rows after the restore; the offer sees that once.
    const polledAt = new Date(NOW + 10_000).toISOString();
    w.rows.set('a', row('a', { status: 'ended', endedAt: polledAt }));
    w.rows.set('b', row('b', { status: 'ended', endedAt: polledAt }));
    expect(await offeredNames()).toEqual(['a', 'b']);
    // `pan flywheel pause` in a CLI process ends `a` again.
    w.rows.set('a', row('a', { status: 'ended', endedAt: new Date(NOW + 60_000).toISOString() }));
    expect(await offeredNames()).toEqual(['b']);
  });

  it('never records a conversation owned by another machine', async () => {
    const w = world([row('a'), row('vault', { origin: 'vault' }), row('released', { releasedTo: 'env-desk' })]);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    expect(await offeredNames()).toEqual(['a']);
  });

  it('dismiss drops the offer', async () => {
    const w = world([row('a')]);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    dismissBackendRestartRecovery();
    expect(await getBackendRestartRecoverySnapshot()).toEqual({ lostAt: null, cause: 'backend-restart', conversations: [], agents: [], run: null });
  });
});

describe('Resume all', () => {
  it('resumes one conversation at a time through the resume door, then clears the offer', async () => {
    const w = world([row('a'), row('b'), row('c')]);
    let inFlight = 0;
    let maxInFlight = 0;
    const resume = w.deps.resume;
    w.deps.resume = async (name, cause) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      inFlight--;
      return resume(name, cause);
    };
    startBackendRestartRecovery(w.deps);
    await restart(w);

    expect(await startBackendRestartResumeAll()).toEqual({ started: true, conversations: 3 });
    expect(await startBackendRestartResumeAll()).toEqual({ started: false, reason: 'running' });
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
    await vi.advanceTimersByTimeAsync(PRESSURE_WAIT_MS);

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
    expect((await getBackendRestartRecoverySnapshot()).run).toMatchObject({ state: 'running', waitingForPressure: true });

    await vi.advanceTimersByTimeAsync(PRESSURE_WAIT_MS);
    expect(w.resumed).toEqual([]);
    await vi.advanceTimersByTimeAsync(PRESSURE_WAIT_MS);
    expect(w.resumed).toEqual(['a']);
    expect((await getBackendRestartRecoverySnapshot()).run).toMatchObject({ waitingForPressure: true });

    await vi.advanceTimersByTimeAsync(PRESSURE_WAIT_MS);
    expect(w.resumed).toEqual(['a', 'b']);
    expect((await getBackendRestartRecoverySnapshot()).run).toMatchObject({ state: 'done', waitingForPressure: false });
  });

  it('reports a refused resume as failed and keeps that conversation offered', async () => {
    const w = world([row('a'), row('b')]);
    const resume = w.deps.resume;
    w.deps.resume = async (name, cause) => (name === 'a'
      ? { status: 409, body: { error: 'Continued on desk; this copy is read-only' } }
      : resume(name, cause));
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

  it('dismiss cancels a run that waits on pressure, before its next resume', async () => {
    const w = world([row('a'), row('b')]);
    w.bands = ['hard', 'hard', 'hard'];
    startBackendRestartRecovery(w.deps);
    await restart(w);

    await startBackendRestartResumeAll();
    await vi.advanceTimersByTimeAsync(PRESSURE_WAIT_MS);
    dismissBackendRestartRecovery();
    await vi.advanceTimersByTimeAsync(10 * PRESSURE_WAIT_MS);

    expect(w.resumed).toEqual([]);
    expect(await getBackendRestartRecoverySnapshot()).toEqual({ lostAt: null, cause: 'backend-restart', conversations: [], agents: [], run: null });
    expect(await startBackendRestartResumeAll()).toEqual({ started: false, reason: 'nothing-to-resume' });
  });

  it('only one of two concurrent Resume all requests starts a run', async () => {
    const w = world([row('a'), row('b')]);
    startBackendRestartRecovery(w.deps);
    await restart(w);

    const [first, second] = await Promise.all([startBackendRestartResumeAll(), startBackendRestartResumeAll()]);
    expect([first, second]).toEqual([{ started: true, conversations: 2 }, { started: false, reason: 'running' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.resumed).toEqual(['a', 'b']);
  });

  it('a failed governor check waits and asks again instead of resuming', async () => {
    const w = world([row('a')]);
    let calls = 0;
    w.deps.pressureBand = async () => {
      calls++;
      if (calls === 1) throw new Error('/proc/pressure unreadable');
      return 'ok';
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBackendRestartRecovery(w.deps);
    await restart(w);

    await startBackendRestartResumeAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.resumed).toEqual([]);
    expect((await getBackendRestartRecoverySnapshot()).run).toMatchObject({ waitingForPressure: true });
    await vi.advanceTimersByTimeAsync(PRESSURE_WAIT_MS);
    expect(w.resumed).toEqual(['a']);
  });

  it('a failed resume whose row comes up and ends again later stays offered', async () => {
    const w = world([row('a')]);
    w.deps.resume = async (name, cause) => {
      w.resumed.push(name);
      return { status: 500, body: { error: 'runtime not ready' } };
    };
    startBackendRestartRecovery(w.deps);
    await restart(w);
    w.rows.set('a', row('a', { status: 'ended', endedAt: new Date(NOW + 10_000).toISOString() }));
    expect(await offeredNames()).toEqual(['a']);

    await startBackendRestartResumeAll();
    await vi.advanceTimersByTimeAsync(0);
    // The pane came up and died: the lifecycle poll ends the row with a new ended_at.
    w.rows.set('a', row('a', { status: 'ended', endedAt: new Date(NOW + 90_000).toISOString() }));
    expect(await offeredNames()).toEqual(['a']);
    // A later change is a stop again.
    w.rows.set('a', row('a', { status: 'ended', endedAt: new Date(NOW + 200_000).toISOString() }));
    expect(await offeredNames()).toEqual([]);
  });

  it('never resumes anything on its own', async () => {
    const w = world([row('a')]);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    await vi.advanceTimersByTimeAsync(10 * PRESSURE_WAIT_MS);
    expect(w.resumed).toEqual([]);
    expect(await offeredNames()).toEqual(['a']);
  });
});

function stopped(kind: ShutdownStoppedSession['kind'], id: string, overrides: Partial<ShutdownStoppedSession> = {}): ShutdownStoppedSession {
  return kind === 'conversation'
    ? { kind, id: `conv-${id}`, name: id, label: `Title ${id}`, wasWorking: true, ...overrides }
    : { kind, id, issueId: id.replace(/^agent-/, '').toUpperCase(), label: `Agent ${id}`, wasWorking: false, ...overrides };
}

describe('the offer a safe shutdown seeds (PAN-5342)', () => {
  it('lists the mid-turn conversations and every agent, with cause shutdown', async () => {
    const w = world([
      row('a', { status: 'ended', endedAt: new Date(NOW - 1_000).toISOString() }),
      row('idle', { status: 'ended', endedAt: new Date(NOW - 1_000).toISOString() }),
    ]);
    w.agentStates = new Set(['agent-pan-1', 'agent-pan-2']);
    // The drain's own stops left stop marks on both conversations.
    w.stopped.set('a', NOW - 1_000);
    w.stopped.set('idle', NOW - 1_000);
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([
      stopped('conversation', 'a'),
      stopped('conversation', 'idle', { wasWorking: false }),
      stopped('agent', 'agent-pan-1'),
      stopped('agent', 'agent-pan-2', { issueId: undefined }),
    ]);

    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot).toEqual({
      lostAt: new Date(NOW).toISOString(),
      cause: 'shutdown',
      conversations: [{ name: 'a', title: 'Title a' }],
      agents: [
        { id: 'agent-pan-1', issueId: 'PAN-1', label: 'Agent agent-pan-1' },
        { id: 'agent-pan-2', issueId: null, label: 'Agent agent-pan-2' },
      ],
      run: null,
    });
  });

  it('merges the conversations an earlier offer still holds', async () => {
    const w = world([row('old')]);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    expect(await offeredNames()).toEqual(['old']);
    // A day later a shutdown stops a conversation started since.
    vi.setSystemTime(NOW + 24 * 60 * 60_000);
    w.rows.set('a', row('a', { status: 'ended', endedAt: new Date(NOW + 24 * 60 * 60_000).toISOString() }));

    seedShutdownOffer([stopped('conversation', 'a')]);
    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot.cause).toBe('shutdown');
    expect(snapshot.conversations.map((c) => c.name)).toEqual(['old', 'a']);
  });

  it('offers agents alone, and drops a conversation stopped again after the offer', async () => {
    const endedAt = new Date(NOW - 1_000).toISOString();
    const w = world([row('a', { status: 'ended', endedAt })]);
    w.agentStates = new Set(['agent-pan-1']);
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([stopped('conversation', 'a'), stopped('agent', 'agent-pan-1')]);
    expect(await offeredNames()).toEqual(['a']);

    w.rows.set('a', row('a', { status: 'ended', endedAt: new Date(NOW + 5_000).toISOString() }));
    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot.conversations).toEqual([]);
    expect(snapshot.agents.map((a) => a.id)).toEqual(['agent-pan-1']);
    expect(snapshot.lostAt).toBe(new Date(NOW).toISOString());
  });

  it('seeds nothing when the drain stopped only idle conversations', async () => {
    const w = world([row('idle', { status: 'ended', endedAt: new Date(NOW).toISOString() })]);
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([stopped('conversation', 'idle', { wasWorking: false })]);
    expect(await getBackendRestartRecoverySnapshot()).toEqual({ lostAt: null, cause: 'backend-restart', conversations: [], agents: [], run: null });
  });

  it('drops an agent whose pane runs again or whose state is gone, and keeps it when the inventory does not answer', async () => {
    const w = world([]);
    w.agentStates = new Set(['agent-pan-1', 'agent-pan-2']);
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([stopped('agent', 'agent-pan-1'), stopped('agent', 'agent-pan-2'), stopped('agent', 'agent-pan-3')]);

    w.liveAgents = null;
    expect((await getBackendRestartRecoverySnapshot()).agents.map((a) => a.id)).toEqual(['agent-pan-1', 'agent-pan-2']);
    w.liveAgents = new Set(['agent-pan-1']);
    expect((await getBackendRestartRecoverySnapshot()).agents.map((a) => a.id)).toEqual(['agent-pan-2']);
  });

  it('Resume all resumes the conversations as the operator, then each agent with resume cause operator', async () => {
    const w = world([row('a', { status: 'ended', endedAt: new Date(NOW).toISOString() })]);
    w.agentStates = new Set(['agent-pan-1', 'agent-pan-2']);
    w.bands = ['ok', 'hard', 'ok'];
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([stopped('conversation', 'a'), stopped('agent', 'agent-pan-1'), stopped('agent', 'agent-pan-2')]);

    expect(await startBackendRestartResumeAll()).toEqual({ started: true, conversations: 1, agents: 2 });
    await vi.advanceTimersByTimeAsync(0);
    // The second resume waits for memory pressure to fall.
    expect(w.resumed).toEqual(['a']);
    expect(w.causes).toEqual(['operator']);
    expect(w.resumedAgents).toEqual([]);
    expect((await getBackendRestartRecoverySnapshot()).run).toMatchObject({ state: 'running', waitingForPressure: true });

    await vi.advanceTimersByTimeAsync(PRESSURE_WAIT_MS);
    expect(w.resumedAgents).toEqual([
      { id: 'agent-pan-1', message: undefined, resumeCause: 'operator' },
      { id: 'agent-pan-2', message: undefined, resumeCause: 'operator' },
    ]);
    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot.run?.results).toEqual([
      { name: 'a', outcome: 'resumed' },
      { name: 'agent-pan-1', outcome: 'resumed' },
      { name: 'agent-pan-2', outcome: 'resumed' },
    ]);
    expect(snapshot.run?.state).toBe('done');
    expect(snapshot.agents).toEqual([]);
    expect(snapshot.conversations).toEqual([]);
  });

  it('reports an agent that runs again by the time its turn comes as already-running, and one whose state is gone as skipped', async () => {
    const w = world([]);
    w.agentStates = new Set(['agent-pan-1', 'agent-pan-2', 'agent-pan-3']);
    w.bands = ['hard'];
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([stopped('agent', 'agent-pan-1'), stopped('agent', 'agent-pan-2'), stopped('agent', 'agent-pan-3')]);

    expect(await startBackendRestartResumeAll()).toEqual({ started: true, conversations: 0, agents: 3 });
    // While the run waits on pressure, agent-pan-1 comes back and agent-pan-2's state is removed.
    w.liveAgents?.add('agent-pan-1');
    w.agentStates.delete('agent-pan-2');
    await vi.advanceTimersByTimeAsync(PRESSURE_WAIT_MS);

    expect(w.resumedAgents.map((a) => a.id)).toEqual(['agent-pan-3']);
    expect((await getBackendRestartRecoverySnapshot()).run?.results).toEqual([
      { name: 'agent-pan-1', outcome: 'already-running' },
      { name: 'agent-pan-2', outcome: 'skipped', reason: 'not found' },
      { name: 'agent-pan-3', outcome: 'resumed' },
    ]);
  });

  it('reports a refused agent resume as failed and keeps that agent offered', async () => {
    const w = world([]);
    w.agentStates = new Set(['agent-pan-1']);
    w.deps.resumeAgent = async () => ({ success: false, error: 'Cannot resume agent-pan-1: troubled' });
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([stopped('agent', 'agent-pan-1')]);

    await startBackendRestartResumeAll();
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot.run?.results).toEqual([{ name: 'agent-pan-1', outcome: 'failed', reason: 'Cannot resume agent-pan-1: troubled' }]);
    expect(snapshot.agents.map((a) => a.id)).toEqual(['agent-pan-1']);
  });

  it('a terminal-backend restart after the shutdown offer carries its agents and cause into the new incident', async () => {
    const w = world([row('b')]);
    w.agentStates = new Set(['agent-pan-1']);
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([stopped('agent', 'agent-pan-1')]);

    vi.setSystemTime(NOW + 60_000);
    await restart(w);
    const snapshot = await getBackendRestartRecoverySnapshot();
    expect(snapshot.cause).toBe('shutdown');
    expect(snapshot.lostAt).toBe(new Date(NOW + 60_000).toISOString());
    expect(snapshot.conversations.map((c) => c.name)).toEqual(['b']);
    expect(snapshot.agents.map((a) => a.id)).toEqual(['agent-pan-1']);
  });

  it('a terminal-backend restart with only carried agents keeps the offer', async () => {
    const w = world([]);
    w.agentStates = new Set(['agent-pan-1']);
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([stopped('agent', 'agent-pan-1')]);
    await restart(w);
    expect((await getBackendRestartRecoverySnapshot()).agents.map((a) => a.id)).toEqual(['agent-pan-1']);
  });

  it('a terminal-backend restart resumes conversations with resume cause system', async () => {
    const w = world([row('a')]);
    startBackendRestartRecovery(w.deps);
    await restart(w);
    await startBackendRestartResumeAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.causes).toEqual(['system']);
  });

  it('never resumes anything on its own', async () => {
    const w = world([]);
    w.agentStates = new Set(['agent-pan-1']);
    startBackendRestartRecovery(w.deps);
    seedShutdownOffer([stopped('agent', 'agent-pan-1')]);
    await vi.advanceTimersByTimeAsync(10 * PRESSURE_WAIT_MS);
    expect(w.resumedAgents).toEqual([]);
  });
});
