/**
 * PAN-5250 WI-7: the idle-stop service. Every dep is injected; journals live in
 * memory so the read-back sees what the poll appended. Timer tests use fake
 * timers (NFR-1): one poll per STACK_IDLE_POLL_MS, no real waiting.
 */
import type { BackendPane } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PipelineJournalEntry } from '../../../../lib/cloister/pipeline-journal.js';
import type { QualityGateQueueSnapshot } from '../../../../lib/cloister/quality-gate-admission.js';
import type { IdleStopConfig } from '../../../../lib/workspace/stack-idle-config.js';
import type { ComposeContainer } from '../../../../lib/workspace/stack-reclaim-docker.js';
import type { ContainerUsageResult } from '../../../../lib/workspace/stack-usage-probe.js';
import type { WorkspaceRow } from '../../../../lib/workspaces/types.js';
import {
  STACK_IDLE_POLL_MS,
  runStackIdleStopPoll,
  startStackIdleStopService,
  stopStackIdleStopService,
  type StackIdleStopDeps,
} from '../stack-idle-stop-service.js';

const GiB = 1024 ** 3;
const ISSUE = 'MIN-1144';
const WS = '/ws/feature-min-1144';
const PROJECT = 'myn-feature-min-1144';
const FRONTEND = `${PROJECT}-frontend-1`;
const POSTGRES = `${PROJECT}-postgres-1`;
const CONFIG: IdleStopConfig = { enabled: true, minutes: 20, services: new Set(['frontend', 'fe', 'dev']) };
const EMPTY_QUEUE: QualityGateQueueSnapshot = { slots: 2, owners: [], waiters: [] };

function container(service: string, overrides: Partial<ComposeContainer> = {}): ComposeContainer {
  const name = `${PROJECT}-${service}-1`;
  return { id: `id-${name}`, name, state: 'running', composeProject: PROJECT, composeService: service, ...overrides };
}

function pane(overrides: Partial<BackendPane>): BackendPane {
  return { id: 'p', role: 'work', harness: 'claude-code', model: 'claude-opus-5-5', state: 'idle', issue: ISSUE, ...overrides };
}

const QUIET: ContainerUsageResult = { inboundConnections: 0, execSessions: 0 };

/** One frontend target plus a postgres of the same project, quiet and unpinned, unless a test says otherwise. */
function world(overrides: Partial<StackIdleStopDeps> = {}) {
  const journals = new Map<string, PipelineJournalEntry[]>();
  let running: ComposeContainer[] = [container('frontend'), container('postgres')];
  let usage: ContainerUsageResult = QUIET;
  const deps = {
    listWorkspaces: vi.fn((): WorkspaceRow[] => [{ id: ISSUE, kind: 'issue', issueId: ISSUE, path: WS } as WorkspaceRow]),
    pathExists: vi.fn(() => true),
    projectRegistered: vi.fn(() => true),
    configFor: vi.fn(() => CONFIG),
    composeProjectFor: vi.fn(() => PROJECT),
    listRunningContainers: vi.fn(async (): Promise<ComposeContainer[] | null> => running.filter((c) => c.state === 'running')),
    listPanes: vi.fn(async (): Promise<BackendPane[] | null> => []),
    readQueue: vi.fn(async (): Promise<QualityGateQueueSnapshot> => EMPTY_QUEUE),
    verificationBusy: vi.fn(() => false),
    isPinned: vi.fn(() => false),
    probeUsage: vi.fn(async (names: readonly string[]): Promise<Map<string, ContainerUsageResult> | null> =>
      new Map(names.map((name) => [name, usage]))),
    readMemoryBytes: vi.fn(async (names: readonly string[]): Promise<Map<string, number> | null> =>
      new Map(names.map((name) => [name, 1.3 * GiB]))),
    readJournal: vi.fn((path: string) => [...(journals.get(path) ?? [])]),
    appendEntry: vi.fn((path: string, entry: Omit<PipelineJournalEntry, 'at'>) => {
      const stamped = { at: new Date(Date.now()).toISOString(), ...entry } as PipelineJournalEntry;
      journals.set(path, [...(journals.get(path) ?? []), stamped]);
      return stamped;
    }),
    stopContainer: vi.fn(async (id: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      running = running.map((c) => (c.id === id ? { ...c, state: 'exited' } : c));
      return { ok: true };
    }),
    emitActivity: vi.fn(),
    withLock: vi.fn(async <T>(_lockPath: string, fn: () => Promise<T>): Promise<T> => fn()),
    now: vi.fn(() => Date.now()),
    ...overrides,
  };
  return {
    deps: deps as unknown as StackIdleStopDeps & typeof deps,
    journals,
    setUsage: (next: ContainerUsageResult) => { usage = next; },
  };
}

async function polls(count: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(count * STACK_IDLE_POLL_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-23T10:00:00.000Z'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  stopStackIdleStopService();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('idle-stop service timeline', () => {
  it('stops the frontend by id on the 21st poll after 20 unused minutes, journaling first', async () => {
    const { deps, journals } = world();
    startStackIdleStopService(deps);

    await polls(20);
    expect(deps.stopContainer).not.toHaveBeenCalled();
    await polls(1);

    expect(deps.stopContainer).toHaveBeenCalledExactlyOnceWith(`id-${FRONTEND}`);
    expect(deps.appendEntry.mock.invocationCallOrder[0]).toBeLessThan(deps.stopContainer.mock.invocationCallOrder[0]!);
    const [entry] = journals.get(WS)!;
    expect(entry).toMatchObject({
      type: 'stack.reclaimed',
      source: 'stack-idle-stop',
      data: {
        containers: [FRONTEND],
        containerIds: [`id-${FRONTEND}`],
        services: ['frontend'],
        composeProject: PROJECT,
        reason: 'idle',
        idleMs: 1_200_000,
      },
    });
    expect(entry?.data?.memoryBytes).toBeCloseTo(1.3 * GiB);
    expect(deps.emitActivity).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      source: 'cloister',
      level: 'info',
      issueId: ISSUE,
      message: `stack-idle-stopped: ${ISSUE}`,
    }));
    const details = deps.emitActivity.mock.calls[0]![0].details as string;
    expect(details).toContain('after 20 min unused');
    expect(details).toContain('1.3 GiB');
    expect(details).toContain(`pan workspace up ${ISSUE}`);
    expect(details).toContain("open the app's URL");
  });

  it('restarts the grace when a browser connects, and stops 20 minutes after it closes', async () => {
    const { deps, setUsage } = world();
    startStackIdleStopService(deps);

    await polls(14);
    setUsage({ inboundConnections: 1, execSessions: 0 });
    await polls(1); // minute 15: in use
    setUsage(QUIET);
    await polls(6); // minute 21
    expect(deps.stopContainer).not.toHaveBeenCalled();
    await polls(14); // minute 35
    expect(deps.stopContainer).not.toHaveBeenCalled();
    await polls(1); // minute 36: 20 minutes after the clock restarted at minute 16
    expect(deps.stopContainer).toHaveBeenCalledOnce();
  });

  it('a working work pane alone does not keep the stack running', async () => {
    const { deps } = world({ listPanes: vi.fn(async () => [pane({ role: 'work', state: 'working' })]) });
    startStackIdleStopService(deps);
    await polls(21);
    expect(deps.stopContainer).toHaveBeenCalledOnce();
  });

  it.each([
    ['a uat pane', { listPanes: vi.fn(async () => [pane({ role: 'uat' })]) }],
    ['a test pane', { listPanes: vi.fn(async () => [pane({ role: 'test' })]) }],
    ['a pin', { isPinned: vi.fn(() => true) }],
    ['a busy verification', { verificationBusy: vi.fn(() => true) }],
    ['a gate-queue waiter', { readQueue: vi.fn(async () => ({ ...EMPTY_QUEUE, waiters: [{ workspacePath: '/elsewhere', gateName: 'tsc', issueId: ISSUE, createdAt: 0 }] })) }],
    ['an unreadable usage probe', { probeUsage: vi.fn(async () => null) }],
  ] as [string, Partial<StackIdleStopDeps>][])('never stops while held by %s', async (_label, overrides) => {
    const { deps } = world(overrides);
    startStackIdleStopService(deps);
    await polls(60);
    expect(deps.stopContainer).not.toHaveBeenCalled();
    expect(deps.appendEntry).not.toHaveBeenCalled();
  });

  it('runs one interval for two starts and clears it on stop', () => {
    const { deps } = world();
    startStackIdleStopService(deps);
    startStackIdleStopService(deps);
    expect(vi.getTimerCount()).toBe(1);
    stopStackIdleStopService();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('runStackIdleStopPoll', () => {
  /** A clock already 20 minutes old, so this poll is due. */
  const dueClock = () => new Map([[ISSUE, Date.now() - 20 * 60_000]]);

  it('stops a due workspace and never the postgres of the same project', async () => {
    const { deps } = world();
    await expect(runStackIdleStopPoll(deps, dueClock())).resolves.toEqual({ kind: 'polled', stopped: [FRONTEND], waiting: [] });
    expect(deps.stopContainer).toHaveBeenCalledExactlyOnceWith(`id-${FRONTEND}`);
    expect(deps.stopContainer).not.toHaveBeenCalledWith(`id-${POSTGRES}`);
  });

  it('skips the stop when a pin appears before the locked re-check, and clears the clock', async () => {
    let pinned = false;
    const { deps } = world({ isPinned: vi.fn(() => pinned) });
    deps.withLock.mockImplementation(async (_lockPath, fn) => {
      pinned = true;
      return fn();
    });
    const clock = dueClock();
    await expect(runStackIdleStopPoll(deps, clock)).resolves.toEqual({ kind: 'polled', stopped: [], waiting: [] });
    expect(deps.appendEntry).not.toHaveBeenCalled();
    expect(deps.stopContainer).not.toHaveBeenCalled();
    expect(clock.has(ISSUE)).toBe(false);
  });

  it('skips the stop when a target was recreated with a new id', async () => {
    const { deps } = world();
    deps.listRunningContainers
      .mockResolvedValueOnce([container('frontend')])
      .mockResolvedValueOnce([container('frontend', { id: 'id-new' })]);
    await runStackIdleStopPoll(deps, dueClock());
    expect(deps.appendEntry).not.toHaveBeenCalled();
    expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('does nothing when the docker listing or the pane inventory is unreadable', async () => {
    const docker = world({ listRunningContainers: vi.fn(async () => null) });
    await expect(runStackIdleStopPoll(docker.deps, dueClock())).resolves.toEqual({ kind: 'idle', reason: 'docker-unreadable' });
    const panes = world({ listPanes: vi.fn(async () => null) });
    await expect(runStackIdleStopPoll(panes.deps, dueClock())).resolves.toEqual({ kind: 'idle', reason: 'inventory-unreadable' });
    const queue = world({ readQueue: vi.fn(async () => ({ ...EMPTY_QUEUE, readError: 'EACCES' })) });
    await expect(runStackIdleStopPoll(queue.deps, dueClock())).resolves.toEqual({ kind: 'idle', reason: 'queue-unreadable' });
    for (const { deps } of [docker, panes, queue]) expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('stops nothing when memory is unreadable or the journal entry does not land', async () => {
    const memory = world({ readMemoryBytes: vi.fn(async () => null) });
    await runStackIdleStopPoll(memory.deps, dueClock());
    expect(memory.deps.appendEntry).not.toHaveBeenCalled();
    expect(memory.deps.stopContainer).not.toHaveBeenCalled();

    const journal = world({ readJournal: vi.fn(() => []) });
    await runStackIdleStopPoll(journal.deps, dueClock());
    expect(journal.deps.appendEntry).toHaveBeenCalledOnce();
    expect(journal.deps.stopContainer).not.toHaveBeenCalled();
  });

  it('never makes a main workspace or an unregistered project a candidate', async () => {
    const main = world({ listWorkspaces: vi.fn(() => [{ id: 'main', kind: 'main', issueId: ISSUE, path: WS } as WorkspaceRow]) });
    const clock = dueClock();
    await expect(runStackIdleStopPoll(main.deps, clock)).resolves.toEqual({ kind: 'polled', stopped: [], waiting: [] });
    expect(clock.size).toBe(0);
    const unregistered = world({ projectRegistered: vi.fn(() => false) });
    await runStackIdleStopPoll(unregistered.deps, dueClock());
    for (const { deps } of [main, unregistered]) expect(deps.stopContainer).not.toHaveBeenCalled();
  });

  it('does nothing while the env switch disables the idle stop', async () => {
    vi.stubEnv('OVERDECK_DISABLE_STACK_IDLE_STOP', '1');
    try {
      const { deps } = world();
      const clock = dueClock();
      await expect(runStackIdleStopPoll(deps, clock)).resolves.toEqual({ kind: 'idle', reason: 'disabled' });
      expect(clock.size).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
