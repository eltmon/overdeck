import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));

import { appendPipelineEntry, readPipelineJournal } from '../../cloister/pipeline-journal.js';
import type { ComposeContainer } from '../stack-reclaim-docker.js';
import type { DockerContainerLifecycle } from '../stack-health.js';
import {
  STACK_LOCK_RENEW_MS,
  restoreReclaimedStack,
  restoreReclaimedStackForSpawn,
  stackLockPath,
  wakeWorkspaceStack,
  withStackLock,
  type StackRestoreDeps,
} from '../stack-restore.js';

const ISSUE = 'MIN-1144';
const PROJECT = 'myn-feature-min-1144';
const API = 'myn-feature-min-1144-api-1';
const FE = 'myn-feature-min-1144-fe-1';
const FRESH: DockerContainerLifecycle[] = [{ id: 'id-api', name: API, status: 'Up 1 second', state: 'running', composeProject: PROJECT }];

let workspace: string;

function container(name: string, state: string, overrides: Partial<ComposeContainer> = {}): ComposeContainer {
  const service = name.replace(/^myn-feature-min-1144-/, '').replace(/-1$/, '');
  return { id: `id-${name}`, name, state, composeProject: PROJECT, composeService: service, ...overrides };
}

function reclaim(containers: string[]): void {
  appendPipelineEntry(workspace, {
    type: 'stack.reclaimed',
    issueId: ISSUE,
    source: 'stack-reclaim',
    data: { containers, composeProject: PROJECT },
  });
}

/** Docker deps whose every call asserts it runs inside the stack lock. */
function world(listed: ComposeContainer[] | null, overrides: Partial<StackRestoreDeps> = {}) {
  let inLock = false;
  const assertInLock = (step: string) => {
    if (!inLock) throw new Error(`${step} ran outside the stack lock`);
  };
  const listContainers = vi.fn(async () => {
    assertInLock('listContainers');
    return listed;
  });
  const startContainer = vi.fn(async (_name: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    assertInLock('startContainer');
    return { ok: true };
  });
  const appendEntry = vi.fn((...args: Parameters<typeof appendPipelineEntry>) => {
    assertInLock('appendEntry');
    return appendPipelineEntry(...args);
  });
  const emitActivity = vi.fn();
  /** Whether each journal read ran inside the lock, in call order. */
  const journalReadsInLock: boolean[] = [];
  const readJournal = vi.fn((path: string) => {
    journalReadsInLock.push(inLock);
    return readPipelineJournal(path);
  });
  const withLock = vi.fn(async <T>(lockPath: string, fn: () => Promise<T>): Promise<T> => {
    expect(lockPath).toBe(stackLockPath(workspace));
    inLock = true;
    try {
      return await fn();
    } finally {
      inLock = false;
    }
  });
  // PAN-5648: stubbed so no door test runs real `docker ps` or writes the
  // global lifecycle cache; a test that cares about the refresh overrides these.
  const collect = vi.fn(async (): Promise<DockerContainerLifecycle[]> => []);
  const record = vi.fn();
  const deps: Partial<StackRestoreDeps> = {
    composeProjectFor: () => PROJECT,
    readJournal,
    listContainers,
    startContainer,
    appendEntry,
    emitActivity,
    withLock,
    collect,
    record,
    ...overrides,
  };
  return { deps, listContainers, startContainer, appendEntry, emitActivity, withLock, journalReadsInLock, collect, record };
}

function restored() {
  return readPipelineJournal(workspace).filter((entry) => entry.type === 'stack.restored');
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'stack-restore-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workspace, { recursive: true, force: true });
});

describe('restoreReclaimedStack (PAN-5623)', () => {
  it('returns none with no open reclaim, taking no lock and calling no docker', async () => {
    appendPipelineEntry(workspace, { type: 'review.requested', issueId: ISSUE });
    const w = world([]);
    await expect(restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'turn' }, w.deps))
      .resolves.toEqual({ kind: 'none' });
    expect(w.withLock).not.toHaveBeenCalled();
    expect(w.listContainers).not.toHaveBeenCalled();
  });

  it('returns none for a workspace path that does not exist', async () => {
    const w = world([]);
    await expect(restoreReclaimedStack({ issueId: ISSUE, workspacePath: join(workspace, 'gone'), trigger: 'turn' }, w.deps))
      .resolves.toEqual({ kind: 'none' });
  });

  it('starts only the exited container and journals the restore, all inside the lock', async () => {
    reclaim([API, FE]);
    const w = world([container(API, 'exited'), container(FE, 'running')]);

    const result = await restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'turn' }, w.deps);

    expect(result).toEqual({ kind: 'restored', started: [API], alreadyRunning: [FE], missing: [], refused: [] });
    expect(w.startContainer).toHaveBeenCalledExactlyOnceWith(API);
    expect(w.withLock).toHaveBeenCalledOnce();
    // The cheap read happens before the lock; the re-read that decides happens inside it.
    expect(w.journalReadsInLock).toEqual([false, true]);
    const [entry] = restored();
    expect(entry).toMatchObject({
      source: 'stack-restore:turn',
      data: { containers: [API, FE], started: [API], alreadyRunning: [FE], missing: [], refused: [], trigger: 'turn' },
    });
    expect(entry?.data?.reclaimedAt).toBe(readPipelineJournal(workspace)[0]?.at);
    expect(w.emitActivity).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister', level: 'info', issueId: ISSUE, message: `stack-restored: ${ISSUE}`, details: `Started ${API} (turn).`,
    }));
  });

  it('records a name absent from the listing as missing and still restores', async () => {
    reclaim([API, FE]);
    const w = world([container(API, 'exited')]);
    await expect(restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'spawn' }, w.deps))
      .resolves.toEqual({ kind: 'restored', started: [API], alreadyRunning: [], missing: [FE], refused: [] });
    expect(restored()).toHaveLength(1);
  });

  it('returns failed and journals nothing when a start fails, after trying every container', async () => {
    reclaim([API, FE]);
    const w = world([container(API, 'exited'), container(FE, 'exited')]);
    w.startContainer.mockImplementation(async (name: string) =>
      (name === API ? { ok: false, error: 'port is already allocated' } : { ok: true }));

    const result = await restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'turn' }, w.deps);

    expect(result).toMatchObject({ kind: 'failed', failed: [API] });
    expect(w.startContainer).toHaveBeenCalledTimes(2);
    expect(restored()).toHaveLength(0);
    expect(w.emitActivity).not.toHaveBeenCalled();
  });

  it('returns failed when the docker listing is unavailable', async () => {
    reclaim([API]);
    const w = world(null);
    await expect(restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'turn' }, w.deps))
      .resolves.toMatchObject({ kind: 'failed' });
    expect(restored()).toHaveLength(0);
  });

  it('returns failed instead of throwing when the lock times out', async () => {
    reclaim([API]);
    const w = world([container(API, 'exited')], {
      withLock: async () => { throw new Error('Could not acquire lock'); },
    });
    await expect(restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'turn' }, w.deps))
      .resolves.toMatchObject({ kind: 'failed', error: expect.stringContaining('Could not acquire lock') });
  });

  it('never passes an invalid journaled name to docker start', async () => {
    reclaim(['x;y', API]);
    const w = world([container(API, 'exited')]);
    const result = await restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'turn' }, w.deps);
    expect(result).toEqual({ kind: 'restored', started: [API], alreadyRunning: [], missing: [], refused: ['x;y'] });
    expect(w.startContainer).not.toHaveBeenCalledWith('x;y');
  });

  it('refuses a non-reclaimable service and a container of another compose project', async () => {
    const postgres = 'myn-feature-min-1144-postgres-1';
    const foreign = 'open-design';
    reclaim([postgres, foreign, API]);
    const w = world([
      container(postgres, 'exited', { composeService: 'postgres' }),
      container(foreign, 'exited', { composeProject: 'open-design', composeService: 'api' }),
      container(API, 'exited'),
    ]);
    const result = await restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'verification' }, w.deps);
    expect(result).toEqual({ kind: 'restored', started: [API], alreadyRunning: [], missing: [], refused: [postgres, foreign] });
    expect(w.startContainer).toHaveBeenCalledExactlyOnceWith(API);
  });

  it('refuses every name when the workspace has no compose project', async () => {
    reclaim([API]);
    const w = world([container(API, 'exited')], { composeProjectFor: () => null });
    await expect(restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'turn' }, w.deps))
      .resolves.toEqual({ kind: 'restored', started: [], alreadyRunning: [], missing: [], refused: [API] });
    expect(w.startContainer).not.toHaveBeenCalled();
  });

  it('returns none on a second call after a successful restore', async () => {
    reclaim([API]);
    const w = world([container(API, 'exited')]);
    await restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'turn' }, w.deps);
    await expect(restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'turn' }, w.deps))
      .resolves.toEqual({ kind: 'none' });
    expect(w.startContainer).toHaveBeenCalledOnce();
  });
});

describe('restore of recorded services and the wake door (PAN-5250)', () => {
  const DEV = 'myn-feature-min-1144-dev-1';
  const FRONTEND = 'myn-feature-min-1144-frontend-1';
  const INIT = 'myn-feature-min-1144-init-1';
  const WAKEABLE: ReadonlySet<string> = new Set(['api', 'fe', 'frontend', 'server', 'dev']);

  function idleReclaim(containers: string[], services: string[]): void {
    appendPipelineEntry(workspace, {
      type: 'stack.reclaimed',
      issueId: ISSUE,
      source: 'stack-idle-stop',
      data: { containers, services, composeProject: PROJECT, reason: 'idle' },
    });
  }

  it('starts a dev container its idle reclaim recorded, without reading the idle-stop config', async () => {
    idleReclaim([FE, DEV], ['fe', 'dev']);
    // The project config changed to services: [] after the stop; the restore door must not care.
    const wakeableServices = vi.fn(() => new Set<string>());
    const w = world([container(FE, 'exited'), container(DEV, 'exited')], { wakeableServices });
    const result = await restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'spawn' }, w.deps);
    expect(result).toEqual({ kind: 'restored', started: [FE, DEV], alreadyRunning: [], missing: [], refused: [] });
    expect(restored()).toHaveLength(1);
    expect(wakeableServices).not.toHaveBeenCalled();
  });

  it('still refuses a postgres container with no recorded service', async () => {
    const postgres = 'myn-feature-min-1144-postgres-1';
    reclaim([postgres]);
    const w = world([container(postgres, 'exited', { composeService: 'postgres' })]);
    const result = await restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' }, w.deps);
    expect(result).toEqual({ kind: 'restored', started: [], alreadyRunning: [], missing: [], refused: [postgres] });
    expect(w.startContainer).not.toHaveBeenCalled();
  });

  it('refuses a container whose recorded service differs from its listed service', async () => {
    idleReclaim([DEV], ['dev']);
    const w = world([container(DEV, 'exited', { composeService: 'postgres' })]);
    const result = await restoreReclaimedStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' }, w.deps);
    expect(result).toMatchObject({ kind: 'restored', refused: [DEV] });
  });

  it('wake starts an exited frontend with no open reclaim and leaves init alone', async () => {
    const w = world([container(FRONTEND, 'exited'), container(INIT, 'exited'), container(API, 'running')], {
      wakeableServices: () => WAKEABLE,
    });
    const result = await wakeWorkspaceStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' }, w.deps);
    expect(result).toEqual({ kind: 'woken', restored: { kind: 'none' }, started: [FRONTEND], alreadyRunning: [API] });
    expect(w.startContainer).toHaveBeenCalledExactlyOnceWith(FRONTEND);
    expect(w.emitActivity).toHaveBeenCalledWith(expect.objectContaining({ message: `stack-woken: ${ISSUE}` }));
    expect(restored()).toHaveLength(0);
  });

  it('wake runs the restore door first and reports what it restored', async () => {
    idleReclaim([DEV], ['dev']);
    let devState = 'exited';
    const w = world(null, {
      wakeableServices: () => WAKEABLE,
      listContainers: async () => [container(DEV, devState)],
      startContainer: async () => { devState = 'running'; return { ok: true }; },
    });
    const result = await wakeWorkspaceStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' }, w.deps);
    expect(result).toMatchObject({ kind: 'woken', started: [], alreadyRunning: [DEV] });
    expect(result.kind === 'woken' && result.restored).toMatchObject({ kind: 'restored', started: [DEV] });
    expect(restored()).toHaveLength(1);
  });

  it('wake records a fresh lifecycle snapshot when it started something', async () => {
    const w = world([container(FRONTEND, 'exited')], { wakeableServices: () => WAKEABLE });
    await wakeWorkspaceStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' }, w.deps);
    expect(w.collect).toHaveBeenCalledOnce();
    const idle = world([container(FRONTEND, 'running')], { wakeableServices: () => WAKEABLE });
    await wakeWorkspaceStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' }, idle.deps);
    expect(idle.collect).not.toHaveBeenCalled();
  });

  it('wake leaves a container of another compose project stopped', async () => {
    const foreign = 'other-project-frontend-1';
    const w = world([container(foreign, 'exited', { composeProject: 'other-project', composeService: 'frontend' })], {
      wakeableServices: () => WAKEABLE,
    });
    const result = await wakeWorkspaceStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' }, w.deps);
    expect(result).toEqual({ kind: 'woken', restored: { kind: 'none' }, started: [], alreadyRunning: [] });
    expect(w.startContainer).not.toHaveBeenCalled();
  });

  it('wake returns failed when a start fails', async () => {
    const w = world([container(FRONTEND, 'exited')], {
      wakeableServices: () => WAKEABLE,
      startContainer: async () => ({ ok: false, error: 'boom' }),
    });
    const result = await wakeWorkspaceStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' }, w.deps);
    expect(result).toEqual({ kind: 'failed', error: `${FRONTEND}: boom`, failed: [FRONTEND] });
  });

  it('a browser wake names its trigger in the activity entry (PAN-5649)', async () => {
    const w = world([container(FRONTEND, 'exited')], { wakeableServices: () => WAKEABLE });
    const result = await wakeWorkspaceStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'browser' }, w.deps);
    expect(result).toMatchObject({ kind: 'woken', started: [FRONTEND] });
    const details = w.emitActivity.mock.calls.map(([entry]) => (entry as { details?: string }).details ?? '');
    expect(details.some((text) => text.endsWith('(browser).'))).toBe(true);
  });

  it('a browser wake closes an idle reclaim with source stack-restore:browser (PAN-5649)', async () => {
    idleReclaim([FRONTEND], ['frontend']);
    const w = world([container(FRONTEND, 'exited')], { wakeableServices: () => WAKEABLE });
    await wakeWorkspaceStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'browser' }, w.deps);
    expect(restored()).toHaveLength(1);
    expect(restored()[0]).toMatchObject({ source: 'stack-restore:browser', data: expect.objectContaining({ trigger: 'browser' }) });
  });

  it('wake returns no-stack for a missing workspace or no compose project', async () => {
    const w = world([], { wakeableServices: () => WAKEABLE });
    await expect(wakeWorkspaceStack({ issueId: ISSUE, workspacePath: join(workspace, 'gone'), trigger: 'operator' }, w.deps))
      .resolves.toEqual({ kind: 'no-stack', reason: 'no-workspace' });
    const none = world([], { wakeableServices: () => WAKEABLE, composeProjectFor: () => null });
    await expect(wakeWorkspaceStack({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' }, none.deps))
      .resolves.toEqual({ kind: 'no-stack', reason: 'no-compose-project' });
  });
});

describe('restoreReclaimedStack snapshot refresh (PAN-5648 restore-refresh-snapshot, CodeRabbit r4672667736/787)', () => {
  it('records the fresh snapshot before journaling stack.restored, and the result carries it (ac1)', async () => {
    reclaim([API]);
    const w = world([container(API, 'exited')]);
    const record = vi.fn();

    const result = await restoreReclaimedStack(
      { issueId: ISSUE, workspacePath: workspace, trigger: 'turn' },
      { ...w.deps, collect: async () => FRESH, record },
    );

    expect(result).toMatchObject({ kind: 'restored', started: [API], snapshot: FRESH });
    expect(record).toHaveBeenCalledExactlyOnceWith(FRESH);
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(w.appendEntry.mock.invocationCallOrder[0]!);
  });

  it('on a partial failure, returns failed carrying the started name and a refreshed snapshot (ac2)', async () => {
    reclaim([API, FE]);
    const w = world([container(API, 'exited'), container(FE, 'exited')]);
    w.startContainer.mockImplementation(async (name: string) =>
      (name === FE ? { ok: false, error: 'port is already allocated' } : { ok: true }));
    const record = vi.fn();

    const result = await restoreReclaimedStack(
      { issueId: ISSUE, workspacePath: workspace, trigger: 'turn' },
      { ...w.deps, collect: async () => FRESH, record },
    );

    expect(result).toMatchObject({ kind: 'failed', failed: [FE], started: [API], snapshot: FRESH });
    expect(record).toHaveBeenCalledExactlyOnceWith(FRESH);
  });
});

describe('restoreReclaimedStackForSpawn (PAN-5623)', () => {
  const fresh: DockerContainerLifecycle[] = [{ id: 'id-api', name: API, status: 'Up 1 second', state: 'running', composeProject: PROJECT }];

  it('returns the recorded fresh listing when something started', async () => {
    reclaim([API]);
    const w = world([container(API, 'exited')]);
    const record = vi.fn();
    const result = await restoreReclaimedStackForSpawn(ISSUE, workspace, { ...w.deps, collect: async () => fresh, record });
    expect(result).toBe(fresh);
    expect(record).toHaveBeenCalledExactlyOnceWith(fresh);
    expect(restored()[0]?.source).toBe('stack-restore:spawn');
  });

  it('returns a fresh recorded listing when every container is already running (PAN-5648 restore-refresh-snapshot.ac3)', async () => {
    reclaim([API]);
    const w = world([container(API, 'running')]);
    const collect = vi.fn(async () => fresh);
    const record = vi.fn();
    const result = await restoreReclaimedStackForSpawn(ISSUE, workspace, { ...w.deps, collect, record });
    expect(result).toBe(fresh);
    expect(record).toHaveBeenCalledExactlyOnceWith(fresh);
  });

  it('returns undefined without recording when the fresh listing fails or is empty (PAN-5648 restore-refresh-snapshot.ac5)', async () => {
    for (const collect of [async () => { throw new Error('docker not found'); }, async () => []]) {
      rmSync(workspace, { recursive: true, force: true });
      workspace = mkdtempSync(join(tmpdir(), 'stack-restore-'));
      reclaim([API]);
      const w = world([container(API, 'exited')]);
      const record = vi.fn();
      await expect(restoreReclaimedStackForSpawn(ISSUE, workspace, { ...w.deps, collect, record })).resolves.toBeUndefined();
      expect(record).not.toHaveBeenCalled();
    }
  });

  it('on a partial failure, still returns the fresh listing with record called once (PAN-5648 restore-refresh-snapshot.ac2)', async () => {
    reclaim([API, FE]);
    const w = world([container(API, 'exited'), container(FE, 'exited')]);
    w.startContainer.mockImplementation(async (name: string) =>
      (name === FE ? { ok: false, error: 'port is already allocated' } : { ok: true }));
    const record = vi.fn();

    const result = await restoreReclaimedStackForSpawn(ISSUE, workspace, { ...w.deps, collect: async () => FRESH, record });

    expect(result).toBe(FRESH);
    expect(record).toHaveBeenCalledExactlyOnceWith(FRESH);
  });

  it('for "none", refreshes only when the newest stack.* entry is stack.restored, never touching docker otherwise (PAN-5648 restore-refresh-snapshot.ac4)', async () => {
    appendPipelineEntry(workspace, { type: 'stack.reclaimed', issueId: ISSUE, data: { containers: [API], composeProject: PROJECT } });
    appendPipelineEntry(workspace, { type: 'stack.restored', issueId: ISSUE, data: { containers: [API] } });
    const restoredCase = world([]);
    const collectRestored = vi.fn(async () => FRESH);
    const recordRestored = vi.fn();
    await expect(restoreReclaimedStackForSpawn(ISSUE, workspace, { ...restoredCase.deps, collect: collectRestored, record: recordRestored }))
      .resolves.toBe(FRESH);
    expect(collectRestored).toHaveBeenCalledOnce();
    expect(recordRestored).toHaveBeenCalledExactlyOnceWith(FRESH);

    rmSync(workspace, { recursive: true, force: true });
    workspace = mkdtempSync(join(tmpdir(), 'stack-restore-'));
    const bareCase = world([]);
    const collectBare = vi.fn(async () => FRESH);
    await expect(restoreReclaimedStackForSpawn(ISSUE, workspace, { ...bareCase.deps, collect: collectBare }))
      .resolves.toBeUndefined();
    expect(collectBare).not.toHaveBeenCalled();
  });
});

describe('withStackLock (PAN-5623)', () => {
  it('creates the .overdeck directory and runs the callback holding the lock', async () => {
    const lockPath = stackLockPath(workspace);
    const seen = await withStackLock(lockPath, async () => existsSync(lockPath), 1_000);
    expect(seen).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('rejects for a removed workspace and never re-creates it', async () => {
    const gone = join(workspace, 'reaped');
    await expect(withStackLock(stackLockPath(gone), async () => 'ran', 1_000)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(existsSync(gone)).toBe(false);
  });
});

describe('withStackLock lock renewal (PAN-5648 stack-lock-renew, CodeRabbit r4672667704 part a)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('touches the lock twice over 120000 ms while fn runs (ac1)', async () => {
    const lockPath = stackLockPath(workspace);
    const touch = vi.fn(async () => {});
    const resultPromise = withStackLock(lockPath, async () => {
      await vi.advanceTimersByTimeAsync(STACK_LOCK_RENEW_MS * 2);
      return 'ran';
    }, 1_000, { touch });

    await expect(resultPromise).resolves.toBe('ran');
    expect(touch).toHaveBeenCalledTimes(2);
    expect(touch).toHaveBeenCalledWith(lockPath);
  });

  it('stops renewing once withStackLock has resolved (ac2)', async () => {
    const lockPath = stackLockPath(workspace);
    const touch = vi.fn(async () => {});
    await withStackLock(lockPath, async () => {
      await vi.advanceTimersByTimeAsync(STACK_LOCK_RENEW_MS);
      return 'ran';
    }, 1_000, { touch });
    expect(touch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(STACK_LOCK_RENEW_MS * 2);

    expect(touch).toHaveBeenCalledTimes(1);
  });

  it('still resolves with fn\'s value when a renewal touch rejects (ac3)', async () => {
    const lockPath = stackLockPath(workspace);
    const touch = vi.fn(async () => { throw new Error('ENOENT'); });
    const resultPromise = withStackLock(lockPath, async () => {
      await vi.advanceTimersByTimeAsync(STACK_LOCK_RENEW_MS);
      return 'ran';
    }, 1_000, { touch });

    await expect(resultPromise).resolves.toBe('ran');
    expect(touch).toHaveBeenCalledTimes(1);
  });
});
