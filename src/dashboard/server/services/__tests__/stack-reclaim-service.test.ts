/**
 * PAN-5623 WI-12/WI-13: the stack reclaim and restore polls. Every dep is
 * mocked; journals live in memory so read-back and once-per-episode checks
 * see what the poll appended. Timer tests use fake timers (NFR-1).
 */
import type { BackendPane } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idleStop = vi.hoisted(() => ({ startStackIdleStopService: vi.fn(), stopStackIdleStopService: vi.fn() }));
vi.mock('../stack-idle-stop-service.js', () => idleStop);

import type { GateStarvationRecord } from '../../../../lib/cloister/gate-starvation.js';
import type { PipelineJournalEntry } from '../../../../lib/cloister/pipeline-journal.js';
import type { QualityGateQueueSnapshot } from '../../../../lib/cloister/quality-gate-admission.js';
import type { ComposeContainer } from '../../../../lib/workspace/stack-reclaim-docker.js';
import type { TurnState } from '../../../../lib/workspace/stack-reclaim.js';
import type { WorkspaceRow } from '../../../../lib/workspaces/types.js';
import {
  STACK_RECLAIM_POLL_MS,
  STACK_RESTORE_POLL_MS,
  createStackReclaimState,
  runStackReclaimPoll,
  runStackRestorePoll,
  stackReclaimStateForTests,
  startStackReclaimService,
  stopStackReclaimService,
  type StackReclaimServiceDeps,
} from '../stack-reclaim-service.js';

const GiB = 1024 ** 3;
const T0 = Date.parse('2026-11-23T10:00:00.000Z');
const SINCE = new Date(T0).toISOString();

const RECORD: GateStarvationRecord = {
  version: 1,
  since: SINCE,
  openedAtMs: T0,
  announced: true,
  head: { ticketId: 't1', issueId: 'PAN-9', gateName: 'tsc:tsconfig.json', workspacePath: '/ws/feature-pan-9', createdAt: T0 - 600_000 },
  memAvailableBytes: 9 * GiB,
  hardReserveBytes: 8 * GiB,
  footprintBytes: 2.86 * GiB,
  holders: [],
};

const HEAD = { workspacePath: '/ws/feature-pan-9', gateName: 'tsc:tsconfig.json', issueId: 'PAN-9', createdAt: T0 - 600_000, footprintKey: 'tsc:tsconfig.json' };
const QUEUE: QualityGateQueueSnapshot = { slots: 2, owners: [], waiters: [HEAD], lastAdmittedAt: T0 - 60_000 };

const wsPath = (issue: string) => `/ws/feature-${issue.toLowerCase()}`;
const project = (issue: string) => `myn-feature-${issue.toLowerCase()}`;

function workspace(issue: string): WorkspaceRow {
  return { id: issue, kind: 'issue', issueId: issue, path: wsPath(issue) } as WorkspaceRow;
}

function stackContainer(issue: string, service: string, overrides: Partial<ComposeContainer> = {}): ComposeContainer {
  const name = `${project(issue)}-${service}-1`;
  return { id: `id-${name}`, name, state: 'running', composeProject: project(issue), composeService: service, ...overrides };
}

function pane(overrides: Partial<BackendPane>): BackendPane {
  return { id: 'p', role: 'work', harness: 'claude-code', model: 'claude-opus-5-5', state: 'idle', ...overrides };
}

/** One eligible, merge-ready issue (MIN-1144, 1.2 GiB) unless a test says otherwise. */
function world(overrides: Partial<StackReclaimServiceDeps> = {}) {
  const journals = new Map<string, PipelineJournalEntry[]>();
  let inLock = false;
  let clock = T0 + 30 * 60_000;
  const memory = new Map<string, number>([
    [`${project('MIN-1144')}-api-1`, 0.7 * GiB],
    [`${project('MIN-1144')}-fe-1`, 0.5 * GiB],
  ]);
  const deps = {
    withLock: vi.fn(async <T>(_lockPath: string, fn: () => Promise<T>): Promise<T> => {
      inLock = true;
      try {
        return await fn();
      } finally {
        inLock = false;
      }
    }),
    readRecord: vi.fn(async (): Promise<GateStarvationRecord | null> => RECORD),
    readQueue: vi.fn(async (): Promise<QualityGateQueueSnapshot> => QUEUE),
    readMemory: vi.fn(async () => ({ memAvailableBytes: 9 * GiB, memTotalBytes: 64 * GiB })),
    readHardReserveBytes: vi.fn(async () => 8 * GiB),
    readEstimate: vi.fn(async () => 2.86 * GiB),
    listWorkspaces: vi.fn(() => [workspace('MIN-1144')]),
    pathExists: vi.fn(() => true),
    projectRegistered: vi.fn(() => true),
    composeProjectFor: vi.fn((_path: string, issueId: string) => project(issueId)),
    listRunningContainers: vi.fn(async (): Promise<ComposeContainer[] | null> => [
      stackContainer('MIN-1144', 'api'),
      stackContainer('MIN-1144', 'fe'),
    ]),
    listPanes: vi.fn(async (): Promise<BackendPane[] | null> => []),
    turnState: vi.fn((_agentId: string): TurnState => 'boundary'),
    verificationBusy: vi.fn((_issueId: string) => false),
    readJournal: vi.fn((path: string) => [...(journals.get(path) ?? [])]),
    readMemoryBytes: vi.fn(async (names: readonly string[]) => new Map(names.map((name) => [name, memory.get(name) ?? 0]))),
    mergeReady: vi.fn(async (_issueId: string) => true),
    appendEntry: vi.fn((path: string, entry: Omit<PipelineJournalEntry, 'at'>) => {
      if (!inLock) throw new Error('append outside the stack lock');
      const stamped = { at: new Date(clock++).toISOString(), ...entry } as PipelineJournalEntry;
      journals.set(path, [...(journals.get(path) ?? []), stamped]);
      return stamped;
    }),
    stopContainer: vi.fn(async (_id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!inLock) throw new Error('stop outside the stack lock');
      return { ok: true };
    }),
    emitActivity: vi.fn(),
    restore: vi.fn(async () => ({ kind: 'restored' as const, started: [], alreadyRunning: [], missing: [], refused: [] })),
    isPinned: vi.fn((_workspacePath: string) => false),
    now: vi.fn(() => T0 + 30 * 60_000),
    ...overrides,
  };
  return { deps: deps as unknown as StackReclaimServiceDeps & typeof deps, journals, memory };
}

const stoppedIds = (deps: { stopContainer: ReturnType<typeof vi.fn> }) => deps.stopContainer.mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  stopStackReclaimService();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runStackReclaimPoll (PAN-5623 WI-12)', () => {
  it('does nothing without an open episode, and touches no docker', async () => {
    const { deps } = world({ readRecord: vi.fn(async () => null) });
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'no-episode' });
    expect(deps.listRunningContainers).not.toHaveBeenCalled();
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('does nothing for a closing record', async () => {
    const { deps } = world({ readRecord: vi.fn(async () => ({ ...RECORD, closing: { at: SINCE, reason: 'admitted' as const } })) });
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'no-episode' });
    expect(deps.listRunningContainers).not.toHaveBeenCalled();
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('does nothing once a gate was admitted in this episode', async () => {
    const { deps } = world({ readQueue: vi.fn(async () => ({ ...QUEUE, lastAdmittedAt: T0 })) });
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'episode-ending' });
  });

  it('does nothing for an unreadable queue or a head without a footprint key', async () => {
    const unreadable = world({ readQueue: vi.fn(async () => ({ ...QUEUE, readError: 'EACCES' })) });
    await expect(runStackReclaimPoll(unreadable.deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'queue-unreadable' });
    const { footprintKey: _key, ...bare } = HEAD;
    const unknown = world({ readQueue: vi.fn(async () => ({ ...QUEUE, waiters: [bare] })) });
    await expect(runStackReclaimPoll(unknown.deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'head-unknown' });
  });

  it('does nothing when the head fits alone', async () => {
    const { deps } = world({ readMemory: vi.fn(async () => ({ memAvailableBytes: 12 * GiB, memTotalBytes: 64 * GiB })) });
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'head-fits' });
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('stops only the largest candidate, by container id, after journaling the reclaim', async () => {
    const { deps, journals, memory } = world({
      listWorkspaces: vi.fn(() => [workspace('MIN-1144'), workspace('MIN-1146')]),
      listRunningContainers: vi.fn(async () => [
        stackContainer('MIN-1144', 'api'), stackContainer('MIN-1144', 'fe'),
        stackContainer('MIN-1146', 'api'), stackContainer('MIN-1146', 'fe'),
      ]),
    });
    memory.set(`${project('MIN-1146')}-api-1`, 1.4 * GiB);
    memory.set(`${project('MIN-1146')}-fe-1`, 1.0 * GiB);
    const state = createStackReclaimState();

    const result = await runStackReclaimPoll(deps, state);

    expect(result).toEqual({
      kind: 'reclaimed', issueId: 'MIN-1146',
      stopped: [`${project('MIN-1146')}-api-1`, `${project('MIN-1146')}-fe-1`], failed: [],
    });
    expect(stoppedIds(deps)).toEqual([`id-${project('MIN-1146')}-api-1`, `id-${project('MIN-1146')}-fe-1`]);
    expect(deps.appendEntry.mock.invocationCallOrder[0]).toBeLessThan(deps.stopContainer.mock.invocationCallOrder[0]!);
    const [entry] = journals.get(wsPath('MIN-1146'))!;
    expect(entry).toMatchObject({
      type: 'stack.reclaimed',
      source: 'stack-reclaim',
      data: {
        containers: [`${project('MIN-1146')}-api-1`, `${project('MIN-1146')}-fe-1`],
        containerIds: [`id-${project('MIN-1146')}-api-1`, `id-${project('MIN-1146')}-fe-1`],
        services: ['api', 'fe'],
        composeProject: project('MIN-1146'),
        reason: 'gate-starvation',
        episodeSince: SINCE,
        head: { gateName: 'tsc:tsconfig.json', issueId: 'PAN-9' },
      },
    });
    expect(entry?.data?.memoryBytes).toBeCloseTo(2.4 * GiB);
    expect(journals.has(wsPath('MIN-1144'))).toBe(false);
    expect(deps.emitActivity).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister', level: 'info', issueId: 'MIN-1146', message: 'stack-reclaimed: MIN-1146',
      details: expect.stringContaining(`docker start ${project('MIN-1146')}-api-1 ${project('MIN-1146')}-fe-1`),
    }));
    expect(state.restoreIndex.get('MIN-1146')).toBe(wsPath('MIN-1146'));
  });

  it('never stops a database, cache, dev or foreign-project container', async () => {
    const { deps } = world({
      listRunningContainers: vi.fn(async () => [
        stackContainer('MIN-1144', 'api'),
        stackContainer('MIN-1144', 'postgres'),
        stackContainer('MIN-1144', 'redis'),
        stackContainer('MIN-1144', 'dev'),
        { id: 'id-open-design', name: 'open-design', state: 'running', composeProject: 'open-design', composeService: 'open-design' },
      ]),
    });
    await runStackReclaimPoll(deps, createStackReclaimState());
    expect(stoppedIds(deps)).toEqual([`id-${project('MIN-1144')}-api-1`]);
  });

  it.each([
    ['a gate waiter on its workspace path', { readQueue: vi.fn(async () => ({ ...QUEUE, waiters: [HEAD, { workspacePath: `${wsPath('MIN-1144')}/frontend`, gateName: 'vitest', createdAt: T0 }] })) }],
    ['an active verification', { verificationBusy: vi.fn(() => true) }],
    ['a live test pane', { listPanes: vi.fn(async () => [pane({ role: 'test', issue: 'MIN-1144', agentId: 'agent-min-1144-test' })]) }],
    ['a work pane mid-turn', { listPanes: vi.fn(async () => [pane({ issue: 'MIN-1144', agentId: 'agent-min-1144' })]), turnState: vi.fn((): TurnState => 'in-turn') }],
  ] as const)('skips a candidate with %s', async (_label, overrides) => {
    const { deps } = world(overrides as Partial<StackReclaimServiceDeps>);
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'no-candidates' });
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('skips an issue already reclaimed in this episode', async () => {
    const { deps, journals } = world();
    journals.set(wsPath('MIN-1144'), [{
      at: SINCE, type: 'stack.reclaimed', issueId: 'MIN-1144', data: { containers: ['x'], episodeSince: SINCE },
    }, { at: SINCE, type: 'stack.restored', issueId: 'MIN-1144' }]);
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'no-candidates' });
  });

  it('reclaims an issue with an idle work pane and a finished review pane', async () => {
    const { deps } = world({
      listPanes: vi.fn(async () => [
        pane({ id: 'w', issue: 'MIN-1144', agentId: 'agent-min-1144' }),
        pane({ id: 'r', role: 'review', issue: 'MIN-1144', agentId: 'agent-min-1144-review', state: 'done' }),
      ]),
      turnState: vi.fn((agentId: string): TurnState => (agentId.endsWith('review') ? 'unknown' : 'boundary')),
    });
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toMatchObject({ kind: 'reclaimed', issueId: 'MIN-1144' });
  });

  it('reclaims a blocked issue without asking the merge gate', async () => {
    const { deps, journals } = world({ mergeReady: vi.fn(async () => false) });
    journals.set(wsPath('MIN-1144'), [{ at: SINCE, type: 'blocked.declared', issueId: 'MIN-1144', data: { item: 'wi1', blockers: ['PAN-1'] } }]);
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toMatchObject({ kind: 'reclaimed' });
    expect(deps.mergeReady).not.toHaveBeenCalled();
  });

  it('stops nothing when no candidate is parked', async () => {
    const { deps } = world({ mergeReady: vi.fn(async () => false) });
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'none-parked' });
    expect(deps.appendEntry).not.toHaveBeenCalled();
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('stops nothing when the pane inventory or the docker listing is unreadable', async () => {
    const panes = world({ listPanes: vi.fn(async () => null) });
    await expect(runStackReclaimPoll(panes.deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'inventory-unreadable' });
    const docker = world({ listRunningContainers: vi.fn(async () => null) });
    await expect(runStackReclaimPoll(docker.deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'docker-unreadable' });
    expect(panes.deps.stopContainer).not.toHaveBeenCalled();
    expect(docker.deps.stopContainer).not.toHaveBeenCalled();
  });

  it.each([
    ['a verification that started during the merge-gate wait', (w: ReturnType<typeof world>) => {
      w.deps.verificationBusy.mockReturnValueOnce(false).mockReturnValue(true);
    }],
    ['a gate admitted during the merge-gate wait', (w: ReturnType<typeof world>) => {
      w.deps.readQueue.mockResolvedValueOnce(QUEUE).mockResolvedValue({ ...QUEUE, owners: [HEAD], waiters: [] });
    }],
    ['a target container whose id changed', (w: ReturnType<typeof world>) => {
      w.deps.listRunningContainers
        .mockResolvedValueOnce([stackContainer('MIN-1144', 'api'), stackContainer('MIN-1144', 'fe')])
        .mockResolvedValue([stackContainer('MIN-1144', 'api', { id: 'new-id' }), stackContainer('MIN-1144', 'fe')]);
    }],
  ] as const)('re-checks inside the lock and stops nothing after %s', async (_label, change) => {
    const w = world();
    change(w);
    await expect(runStackReclaimPoll(w.deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'changed-before-stop' });
    expect(w.deps.withLock).toHaveBeenCalledOnce();
    expect(w.deps.appendEntry).not.toHaveBeenCalled();
    expect(w.deps.stopContainer).not.toHaveBeenCalled();
  });

  it('stops nothing when the journal entry does not land', async () => {
    const { deps } = world();
    deps.readJournal.mockReturnValue([]);
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'journal-unwritable' });
    expect(deps.appendEntry).toHaveBeenCalledOnce();
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('skips the poll when the stack lock is busy', async () => {
    const { deps } = world({ withLock: vi.fn(async () => { throw new Error('Could not acquire lock'); }) });
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'lock-busy' });
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('names a failed stop in the activity entry and still reports the reclaim', async () => {
    const { deps } = world();
    deps.stopContainer.mockImplementation(async (id: string) => (id.includes('-fe-') ? { ok: false, error: 'timeout' } : { ok: true }));
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({
      kind: 'reclaimed', issueId: 'MIN-1144', stopped: [`${project('MIN-1144')}-api-1`], failed: [`${project('MIN-1144')}-fe-1`],
    });
    expect(deps.emitActivity).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining(`docker stop failed for ${project('MIN-1144')}-fe-1`),
    }));
  });
});

describe('stack reclaim timer (PAN-5623 WI-12)', () => {
  it('stops one issue per poll', async () => {
    vi.useFakeTimers();
    const running = new Set([
      `${project('MIN-1144')}-api-1`, `${project('MIN-1144')}-fe-1`,
      `${project('MIN-1146')}-api-1`, `${project('MIN-1146')}-fe-1`,
    ]);
    const all = [
      stackContainer('MIN-1144', 'api'), stackContainer('MIN-1144', 'fe'),
      stackContainer('MIN-1146', 'api'), stackContainer('MIN-1146', 'fe'),
    ];
    const { deps } = world({
      listWorkspaces: vi.fn(() => [workspace('MIN-1144'), workspace('MIN-1146')]),
      listRunningContainers: vi.fn(async () => all.filter((container) => running.has(container.name))),
    });
    deps.stopContainer.mockImplementation(async (id: string) => {
      running.delete(id.replace(/^id-/, ''));
      return { ok: true };
    });
    startStackReclaimService(deps);

    await vi.advanceTimersByTimeAsync(STACK_RECLAIM_POLL_MS);
    expect(stoppedIds(deps)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(STACK_RECLAIM_POLL_MS);
    expect(stoppedIds(deps)).toHaveLength(4);
    expect(new Set(stoppedIds(deps).map((id) => id.split('-')[4]))).toEqual(new Set(['1144', '1146']));
  });

  it('catches a thrown dep and polls again on the next interval', async () => {
    vi.useFakeTimers();
    const { deps } = world();
    deps.readRecord.mockRejectedValueOnce(new Error('torn record'));
    startStackReclaimService(deps);

    await vi.advanceTimersByTimeAsync(STACK_RECLAIM_POLL_MS);
    expect(deps.stopContainer).not.toHaveBeenCalled();
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith('[stack-reclaim] poll failed:', 'torn record');

    await vi.advanceTimersByTimeAsync(STACK_RECLAIM_POLL_MS);
    expect(deps.stopContainer).toHaveBeenCalled();
  });
});

describe('runStackRestorePoll (PAN-5623 WI-13)', () => {
  const RECLAIMED: PipelineJournalEntry = {
    at: SINCE, type: 'stack.reclaimed', issueId: 'MIN-1144', data: { containers: [`${project('MIN-1144')}-api-1`], episodeSince: SINCE },
  };

  it('seeds the index on its first tick from open reclaims only', async () => {
    const { deps, journals } = world({ listWorkspaces: vi.fn(() => [workspace('MIN-1144'), workspace('MIN-1146')]) });
    journals.set(wsPath('MIN-1144'), [RECLAIMED]);
    journals.set(wsPath('MIN-1146'), [{ ...RECLAIMED, issueId: 'MIN-1146' }, { at: SINCE, type: 'stack.restored', issueId: 'MIN-1146' }]);
    const state = createStackReclaimState();

    await runStackRestorePoll(deps, state);

    expect([...state.restoreIndex]).toEqual([['MIN-1144', wsPath('MIN-1144')]]);
    expect(state.seeded).toBe(true);
  });

  it('restores with trigger turn when a work pane is mid-turn, then drops the issue', async () => {
    const { deps, journals } = world({
      listPanes: vi.fn(async () => [pane({ issue: 'MIN-1144', agentId: 'agent-min-1144' })]),
      turnState: vi.fn((): TurnState => 'in-turn'),
    });
    journals.set(wsPath('MIN-1144'), [RECLAIMED]);
    const state = createStackReclaimState();

    await runStackRestorePoll(deps, state);

    expect(deps.restore).toHaveBeenCalledExactlyOnceWith({ issueId: 'MIN-1144', workspacePath: wsPath('MIN-1144'), trigger: 'turn' });
    expect(state.restoreIndex.size).toBe(0);
  });

  it('restores nothing while every pane is at a turn boundary', async () => {
    const { deps, journals } = world({ listPanes: vi.fn(async () => [pane({ issue: 'MIN-1144', agentId: 'agent-min-1144' })]) });
    journals.set(wsPath('MIN-1144'), [RECLAIMED]);
    const state = createStackReclaimState();
    await runStackRestorePoll(deps, state);
    expect(deps.restore).not.toHaveBeenCalled();
    expect(state.restoreIndex.has('MIN-1144')).toBe(true);
  });

  it('drops an entry whose journal now shows a restore, without calling restore', async () => {
    const { deps, journals } = world({
      listPanes: vi.fn(async () => [pane({ issue: 'MIN-1144', agentId: 'agent-min-1144', state: 'working' })]),
    });
    journals.set(wsPath('MIN-1144'), [RECLAIMED, { at: SINCE, type: 'stack.restored', issueId: 'MIN-1144' }]);
    const state = createStackReclaimState();
    state.seeded = true;
    state.restoreIndex.set('MIN-1144', wsPath('MIN-1144'));

    await runStackRestorePoll(deps, state);

    expect(deps.restore).not.toHaveBeenCalled();
    expect(state.restoreIndex.size).toBe(0);
  });

  it('never reads the pane inventory with an empty index', async () => {
    const { deps } = world();
    await runStackRestorePoll(deps, createStackReclaimState());
    expect(deps.listPanes).not.toHaveBeenCalled();
  });

  it('retries a failed restore no sooner than 60 s later', async () => {
    vi.useFakeTimers();
    const { deps, journals } = world({
      listPanes: vi.fn(async () => [pane({ issue: 'MIN-1144', agentId: 'agent-min-1144', state: 'working' })]),
      now: vi.fn(() => Date.now()),
      restore: vi.fn(async () => ({ kind: 'failed' as const, failed: [`${project('MIN-1144')}-api-1`], error: 'port is already allocated' })),
    });
    journals.set(wsPath('MIN-1144'), [RECLAIMED]);
    startStackReclaimService(deps);

    await vi.advanceTimersByTimeAsync(STACK_RESTORE_POLL_MS);
    expect(deps.restore).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deps.restore).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(deps.restore).toHaveBeenCalledTimes(2);
    expect(stackReclaimStateForTests()?.restoreIndex.has('MIN-1144')).toBe(true);
  });
});

describe('reclaim reasons and pins (PAN-5250 WI-5)', () => {
  const API = `${project('MIN-1144')}-api-1`;
  const FE = `${project('MIN-1144')}-fe-1`;
  const DEV = `${project('MIN-1144')}-dev-1`;
  const IDLE: PipelineJournalEntry = {
    at: SINCE, type: 'stack.reclaimed', issueId: 'MIN-1144',
    data: { containers: [FE, DEV], services: ['fe', 'dev'], reason: 'idle' },
  };
  const MEMORY: PipelineJournalEntry = {
    at: SINCE, type: 'stack.reclaimed', issueId: 'MIN-1144', data: { containers: [API], episodeSince: 'older' },
  };
  const workingPane = () => vi.fn(async () => [pane({ issue: 'MIN-1144', agentId: 'agent-min-1144', state: 'working' })]);

  it('never restores an idle-only reclaim on a turn, even with a working work pane', async () => {
    const { deps, journals } = world({ listPanes: workingPane() });
    journals.set(wsPath('MIN-1144'), [IDLE]);
    const state = createStackReclaimState();
    state.seeded = true;
    state.restoreIndex.set('MIN-1144', wsPath('MIN-1144'));

    await runStackRestorePoll(deps, state);

    expect(deps.restore).not.toHaveBeenCalled();
    expect(state.restoreIndex.size).toBe(0);
  });

  it('restores once on a turn when a memory reclaim is open beside an idle one', async () => {
    const { deps, journals } = world({ listPanes: workingPane() });
    journals.set(wsPath('MIN-1144'), [IDLE, MEMORY]);
    await runStackRestorePoll(deps, createStackReclaimState());
    expect(deps.restore).toHaveBeenCalledExactlyOnceWith({ issueId: 'MIN-1144', workspacePath: wsPath('MIN-1144'), trigger: 'turn' });
  });

  it('seeds the index without idle-only journals', async () => {
    const { deps, journals } = world({ listWorkspaces: vi.fn(() => [workspace('MIN-1144'), workspace('MIN-1146')]) });
    journals.set(wsPath('MIN-1144'), [IDLE]);
    journals.set(wsPath('MIN-1146'), [{ ...MEMORY, issueId: 'MIN-1146' }]);
    const state = createStackReclaimState();
    await runStackRestorePoll(deps, state);
    expect([...state.restoreIndex]).toEqual([['MIN-1146', wsPath('MIN-1146')]]);
  });

  it('never makes a pinned workspace a reclaim candidate', async () => {
    const { deps } = world({ isPinned: vi.fn(() => true) });
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'no-candidates' });
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('stops nothing when a pin is written before the locked re-check', async () => {
    let pinned = false;
    const { deps } = world({ isPinned: vi.fn(() => pinned) });
    const lock = deps.withLock.getMockImplementation()!;
    deps.withLock.mockImplementation(async (lockPath, fn) => {
      pinned = true;
      return lock(lockPath, fn);
    });
    await expect(runStackReclaimPoll(deps, createStackReclaimState())).resolves.toEqual({ kind: 'idle', reason: 'changed-before-stop' });
    expect(deps.appendEntry).not.toHaveBeenCalled();
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('passes the read-back when an older idle reclaim is already open', async () => {
    const { deps, journals } = world();
    journals.set(wsPath('MIN-1144'), [IDLE]);
    const result = await runStackReclaimPoll(deps, createStackReclaimState());
    expect(result).toEqual({ kind: 'reclaimed', issueId: 'MIN-1144', stopped: [API, FE], failed: [] });
    expect(stoppedIds(deps)).toEqual([`id-${API}`, `id-${FE}`]);
  });
});

describe('idle-stop service wiring (PAN-5250 WI-7)', () => {
  it('starts the idle-stop service once with the reclaim service\'s pane, queue and verification reads', () => {
    idleStop.startStackIdleStopService.mockClear();
    idleStop.stopStackIdleStopService.mockClear();
    const { deps } = world();
    startStackReclaimService(deps);
    startStackReclaimService(deps);
    expect(idleStop.startStackIdleStopService).toHaveBeenCalledOnce();
    expect(idleStop.startStackIdleStopService).toHaveBeenCalledWith({
      listPanes: deps.listPanes,
      readQueue: deps.readQueue,
      verificationBusy: deps.verificationBusy,
    });
    stopStackReclaimService();
    expect(idleStop.stopStackIdleStopService).toHaveBeenCalled();
  });
});
