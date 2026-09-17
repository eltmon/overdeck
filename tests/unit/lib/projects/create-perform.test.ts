/**
 * Tests for performProjectCreate / finishProjectSetup (PAN-3836 WI-1.4/1.5).
 *
 * The injection points here are the ones that actually hurt in production: a
 * clone that fails over a directory the operator already had, a cancel that
 * races the child's own exit, and — the reason finishProjectSetup exists — a
 * registration that lands and *then* fails, which used to strand a project that
 * ordinary create could never retry and nothing else could repair.
 *
 * Real temp directories throughout, because directory *identity* is the thing
 * under test and a mocked fs cannot prove an inode check works.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { TEST_HOME, spawnMock, execFileMock, workspaceMocks } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: j } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir: t } = require('node:os') as typeof import('node:os');
  return {
    TEST_HOME: j(t(), `proj-perform-test-${process.pid}`),
    spawnMock: vi.fn(),
    execFileMock: vi.fn(),
    workspaceMocks: {
      resolveWorkspaceCreateIntent: vi.fn(),
      performWorkspaceCreate: vi.fn(),
      getMainWorkspace: vi.fn(),
    },
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: spawnMock, execFile: execFileMock };
});

vi.mock('../../../../src/lib/paths.js', async () => {
  const real = await vi.importActual<typeof import('../../../../src/lib/paths.js')>(
    '../../../../src/lib/paths.js',
  );
  return { ...real, OVERDECK_HOME: TEST_HOME, CONFIG_DIR: TEST_HOME };
});

vi.mock('../../../../src/lib/workspace-manager.js', () => ({
  preTrustDirectorySync: vi.fn(),
  preTrustDirectory: vi.fn(),
}));

vi.mock('../../../../src/lib/context-layers/index.js', () => ({
  ensureProjectLayer: vi.fn().mockReturnValue(true),
}));

vi.mock('../../../../src/lib/workspaces/resolver.js', () => ({
  getMainWorkspace: workspaceMocks.getMainWorkspace,
}));

vi.mock('../../../../src/lib/workspaces/create.js', () => ({
  resolveWorkspaceCreateIntent: workspaceMocks.resolveWorkspaceCreateIntent,
  performWorkspaceCreate: workspaceMocks.performWorkspaceCreate,
}));

import {
  ProjectCreateFailureError,
  resolveProjectCreateIntent,
  __resetRemoteProbeMemoForTests,
} from '../../../../src/lib/projects/create.js';
import {
  performProjectCreate,
  finishProjectSetup,
} from '../../../../src/lib/projects/create-perform.js';
import {
  PROJECTS_CONFIG_FILE,
  invalidateProjectsConfigCache,
  getProjectSync,
} from '../../../../src/lib/projects.js';

/** A stand-in for the `git clone` child process, driven by the test. */
class FakeChild extends EventEmitter {
  stderr = new EventEmitter();
  killed: string[] = [];
  kill(signal: string): boolean {
    this.killed.push(signal);
    return true;
  }
}

function armCloneChild(): FakeChild {
  const child = new FakeChild();
  spawnMock.mockImplementation(() => child);
  return child;
}

/** A resolved clone intent pointing at a real temp destination. */
async function cloneIntentInto(parentDir: string, name = 'widget') {
  execFileMock.mockImplementation((cmd: string, args: string[], opts: unknown, cb: Function) => {
    if (args[0] === 'ls-remote') cb(null, { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' });
    else cb(new Error('unexpected command'));
  });
  return resolveProjectCreateIntent({
    mode: 'clone',
    url: `acme/${name}`,
    parentDir,
    homeBoundary: false,
    homeDir: TEST_HOME,
  });
}

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
  try {
    rmSync(PROJECTS_CONFIG_FILE);
  } catch {
    /* fine if absent */
  }
  invalidateProjectsConfigCache();
  __resetRemoteProbeMemoForTests();
  spawnMock.mockReset();
  execFileMock.mockReset();
  workspaceMocks.getMainWorkspace.mockReturnValue(null);
  workspaceMocks.resolveWorkspaceCreateIntent.mockResolvedValue({ findings: [] });
  workspaceMocks.performWorkspaceCreate.mockResolvedValue({ id: 'ws-main', path: '' });
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('performProjectCreate — cleanup ownership (D-5)', () => {
  it('removes a target this operation created when the clone fails', async () => {
    const parent = join(TEST_HOME, 'p1');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();

    const running = performProjectCreate(intent);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.stderr.emit('data', Buffer.from('fatal: Authentication failed\n'));
    child.emit('close', 128);

    await expect(running).rejects.toBeInstanceOf(ProjectCreateFailureError);
    expect(existsSync(intent.path!)).toBe(false);
  });

  it('never removes a target that already existed', async () => {
    const parent = join(TEST_HOME, 'p2');
    const target = join(parent, 'widget');
    mkdirSync(target, { recursive: true });
    // An empty pre-existing directory passes resolve, but it is still the
    // operator's, and a failed clone must not take it with it.
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();

    const running = performProjectCreate(intent);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.emit('close', 128);
    await expect(running).rejects.toBeInstanceOf(ProjectCreateFailureError);

    expect(existsSync(target)).toBe(true);
  });

  it('leaves a replaced directory alone even though this operation created one', async () => {
    const parent = join(TEST_HOME, 'p3');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();

    const running = performProjectCreate(intent);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    // Between claim and failure the path became a *different* directory. Removing
    // it would destroy something this operation never owned.
    expect(existsSync(intent.path!)).toBe(true);
    rmSync(intent.path!, { recursive: true, force: true });
    mkdirSync(intent.path!, { recursive: true });
    writeFileSync(join(intent.path!, 'someone-elses.txt'), 'keep me');

    child.emit('close', 128);
    await expect(running).rejects.toBeInstanceOf(ProjectCreateFailureError);

    expect(existsSync(join(intent.path!, 'someone-elses.txt'))).toBe(true);
  });
});

describe('performProjectCreate — cancellation (WI-1.4)', () => {
  it('sends SIGTERM on abort and reports cancelled once the child closes', async () => {
    const parent = join(TEST_HOME, 'c1');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();
    const controller = new AbortController();

    const running = performProjectCreate(intent, { signal: controller.signal });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    controller.abort();
    expect(child.killed).toEqual(['SIGTERM']);

    // Not settled yet: the child can still be writing into the target.
    child.emit('close', 143);
    const failure = await running.catch((err) => err as ProjectCreateFailureError);
    expect(failure).toBeInstanceOf(ProjectCreateFailureError);
    expect((failure as ProjectCreateFailureError).failure.code).toBe('cancelled');
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const parent = join(TEST_HOME, 'c2');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();
    const controller = new AbortController();

    const running = performProjectCreate(intent, { signal: controller.signal });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    controller.abort();
    expect(child.killed).toEqual(['SIGTERM']);

    // A wedged transport ignores SIGTERM; the operator's cancel must still finish.
    vi.advanceTimersByTime(5_000);
    expect(child.killed).toEqual(['SIGTERM', 'SIGKILL']);

    child.emit('close', 137);
    await expect(running).rejects.toBeInstanceOf(ProjectCreateFailureError);
  });

  it('refuses immediately when the signal is already aborted', async () => {
    const parent = join(TEST_HOME, 'c3');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    armCloneChild();

    const controller = new AbortController();
    controller.abort();

    await expect(
      performProjectCreate(intent, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ProjectCreateFailureError);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('settles once even when error and close both fire', async () => {
    const parent = join(TEST_HOME, 'c4');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();

    const running = performProjectCreate(intent);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.emit('error', new Error('spawn ENOENT'));
    child.emit('close', 1); // must be ignored; the promise already settled

    await expect(running).rejects.toBeInstanceOf(ProjectCreateFailureError);
  });

  it('keeps only a bounded tail of clone stderr', async () => {
    const parent = join(TEST_HOME, 'c5');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();

    const running = performProjectCreate(intent);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    for (let i = 0; i < 2000; i++) {
      child.stderr.emit('data', Buffer.from(`Receiving objects: ${i}%\r`));
    }
    child.stderr.emit('data', Buffer.from('fatal: Authentication failed\n'));
    child.emit('close', 128);

    const failure = (await running.catch((e) => e)) as ProjectCreateFailureError;
    expect(failure.failure.code).toBe('authentication-required');
    expect(Buffer.byteLength(failure.failure.detail ?? '', 'utf8')).toBeLessThanOrEqual(4104);
  });
});

describe('finishProjectSetup — repeatable setup (D-9)', () => {
  function registerAt(key: string, path: string): void {
    writeFileSync(PROJECTS_CONFIG_FILE, `projects:\n  ${key}:\n    name: ${key}\n    path: ${path}\n`);
    invalidateProjectsConfigCache();
  }

  it('creates the main workspace once and is safe to run again', async () => {
    const dir = join(TEST_HOME, 'repairable');
    mkdirSync(join(dir, '.git'), { recursive: true });
    registerAt('repairable', dir);

    const first = await finishProjectSetup({ key: 'repairable', expectedPath: dir });
    expect(first.mainWorkspaceId).toBe('ws-main');
    expect(workspaceMocks.performWorkspaceCreate).toHaveBeenCalledTimes(1);

    // Second run finds the workspace already there and must not make another.
    workspaceMocks.getMainWorkspace.mockReturnValue({ id: 'ws-main', path: dir });
    const second = await finishProjectSetup({ key: 'repairable', expectedPath: dir });
    expect(second.mainWorkspaceId).toBe('ws-main');
    expect(workspaceMocks.performWorkspaceCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses to repair when the registered path is not the expected one', async () => {
    const registered = join(TEST_HOME, 'somewhere');
    const expectedPath = join(TEST_HOME, 'elsewhere');
    mkdirSync(registered, { recursive: true });
    mkdirSync(expectedPath, { recursive: true });
    registerAt('mismatch', registered);

    // Repairing the wrong project is worse than refusing.
    await expect(
      finishProjectSetup({ key: 'mismatch', expectedPath }),
    ).rejects.toMatchObject({ failure: { code: 'destination-conflict' } });
  });

  it('adds workspaces/ to .git/info/exclude without corrupting a file that lacks a trailing newline', async () => {
    const dir = join(TEST_HOME, 'excluded');
    mkdirSync(join(dir, '.git', 'info'), { recursive: true });
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '*.log'); // no trailing newline
    registerAt('excluded', dir);

    await finishProjectSetup({ key: 'excluded', expectedPath: dir });

    const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf-8');
    expect(exclude).toContain('*.log\n');
    expect(exclude).toContain('workspaces/');
    expect(exclude).not.toContain('*.logworkspaces');
  });

  it('does not add a second workspaces/ line when one is already there', async () => {
    const dir = join(TEST_HOME, 'already');
    mkdirSync(join(dir, '.git', 'info'), { recursive: true });
    writeFileSync(join(dir, '.git', 'info', 'exclude'), 'workspaces/\n');
    registerAt('already', dir);

    await finishProjectSetup({ key: 'already', expectedPath: dir });

    const lines = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim() === 'workspaces/');
    expect(lines).toHaveLength(1);
  });
});

describe('performProjectCreate — partial registration is repairable, not stranded', () => {
  it('reports setup-incomplete with a repair action when the main workspace fails', async () => {
    const parent = join(TEST_HOME, 'late');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();

    // The clone succeeds; setup fails afterwards. Deleting either would destroy
    // a good clone, so the only correct answer is a repair action.
    workspaceMocks.performWorkspaceCreate.mockRejectedValue(new Error('disk full'));

    const running = performProjectCreate(intent);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.emit('close', 0);

    const failure = (await running.catch((e) => e)) as ProjectCreateFailureError;
    expect(failure.failure.code).toBe('setup-incomplete');
    expect(failure.failure.retrySafe).toBe(false);
    expect(failure.failure.recovery).toEqual({
      action: 'finish-setup',
      key: 'widget',
      path: intent.path,
    });

    // The clone output and the registration both survive for the repair to use.
    expect(existsSync(intent.path!)).toBe(true);
    expect(getProjectSync('widget')).toBeTruthy();
  });

  it('repairs that same project without cloning again', async () => {
    const parent = join(TEST_HOME, 'late2');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();
    workspaceMocks.performWorkspaceCreate.mockRejectedValueOnce(new Error('disk full'));

    const running = performProjectCreate(intent);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.emit('close', 0);
    await running.catch(() => undefined);

    const spawnsBefore = spawnMock.mock.calls.length;
    workspaceMocks.performWorkspaceCreate.mockResolvedValue({ id: 'ws-main', path: intent.path });

    const repaired = await finishProjectSetup({ key: 'widget', expectedPath: intent.path! });

    expect(repaired.mainWorkspaceId).toBe('ws-main');
    // The whole point: repair never re-clones.
    expect(spawnMock.mock.calls.length).toBe(spawnsBefore);
  });

  it('returns real registration metadata rather than a stub', async () => {
    const parent = join(TEST_HOME, 'meta');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();

    const running = performProjectCreate(intent);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    // The clone "creates" a .git so hook installation has something to act on.
    mkdirSync(join(intent.path!, '.git'), { recursive: true });
    child.emit('close', 0);

    const result = await running;
    expect(result.key).toBe('widget');
    expect(result.seededContextLayer).toBe(true);
    expect(typeof result.hooksInstalled).toBe('number');
    expect(statSync(result.path).isDirectory()).toBe(true);
  });

  it('writes the detected remote configuration into the registered project', async () => {
    const parent = join(TEST_HOME, 'cfg');
    mkdirSync(parent, { recursive: true });
    const intent = await cloneIntentInto(parent);
    const child = armCloneChild();

    const running = performProjectCreate(intent);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    child.emit('close', 0);
    await running;

    const config = getProjectSync('widget');
    expect(config?.github_repo).toBe('acme/widget');
    expect(config?.tracker).toBe('github');
    expect(config?.workspace?.default_branch).toBe('main');
    expect(config?.issue_prefix).toBe('WIDGET');
  });
});
