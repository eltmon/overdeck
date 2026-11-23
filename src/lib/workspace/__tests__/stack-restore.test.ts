import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));

import { appendPipelineEntry, readPipelineJournal } from '../../cloister/pipeline-journal.js';
import type { ComposeContainer } from '../stack-reclaim-docker.js';
import type { DockerContainerLifecycle } from '../stack-health.js';
import {
  restoreReclaimedStack,
  restoreReclaimedStackForSpawn,
  stackLockPath,
  withStackLock,
  type StackRestoreDeps,
} from '../stack-restore.js';

const ISSUE = 'MIN-1144';
const PROJECT = 'myn-feature-min-1144';
const API = 'myn-feature-min-1144-api-1';
const FE = 'myn-feature-min-1144-fe-1';

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
  const deps: Partial<StackRestoreDeps> = {
    composeProjectFor: () => PROJECT,
    readJournal,
    listContainers,
    startContainer,
    appendEntry,
    emitActivity,
    withLock,
    ...overrides,
  };
  return { deps, listContainers, startContainer, appendEntry, emitActivity, withLock, journalReadsInLock };
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

  it('returns undefined and records nothing when nothing started', async () => {
    reclaim([API]);
    const w = world([container(API, 'running')]);
    const collect = vi.fn(async () => fresh);
    const record = vi.fn();
    await expect(restoreReclaimedStackForSpawn(ISSUE, workspace, { ...w.deps, collect, record })).resolves.toBeUndefined();
    expect(collect).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('returns undefined without recording when the fresh listing fails or is empty', async () => {
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
