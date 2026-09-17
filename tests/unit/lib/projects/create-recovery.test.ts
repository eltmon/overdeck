/**
 * Tests for resolveProjectCreateRecovery (PAN-3836 WI-1.5, FR-17).
 *
 * The bug this module replaces: when a job poll 404'd, the client looked for a
 * project with the expected key, found one, and declared success. These tests
 * exist to make that impossible — every "completed" here has to survive a path
 * check, an on-disk check, a remote-identity check for clones, and a main
 * workspace check, and every branch that cannot prove completion says so.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { TEST_HOME, execFileMock, getMainWorkspaceMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: j } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir: t } = require('node:os') as typeof import('node:os');
  return {
    TEST_HOME: j(t(), `proj-recovery-test-${process.pid}`),
    execFileMock: vi.fn(),
    getMainWorkspaceMock: vi.fn(),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: execFileMock };
});

vi.mock('../../../../src/lib/paths.js', async () => {
  const real = await vi.importActual<typeof import('../../../../src/lib/paths.js')>(
    '../../../../src/lib/paths.js',
  );
  return { ...real, OVERDECK_HOME: TEST_HOME, CONFIG_DIR: TEST_HOME };
});

vi.mock('../../../../src/lib/workspaces/resolver.js', () => ({
  getMainWorkspace: getMainWorkspaceMock,
}));

vi.mock('../../../../src/lib/workspaces/create.js', () => ({
  resolveWorkspaceCreateIntent: vi.fn(),
  performWorkspaceCreate: vi.fn(),
}));

import { resolveProjectCreateRecovery } from '../../../../src/lib/projects/create-recovery.js';
import {
  PROJECTS_CONFIG_FILE,
  invalidateProjectsConfigCache,
} from '../../../../src/lib/projects.js';

function registerAt(key: string, path: string): void {
  writeFileSync(PROJECTS_CONFIG_FILE, `projects:\n  ${key}:\n    name: ${key}\n    path: ${path}\n`);
  invalidateProjectsConfigCache();
}

function makeRepo(name: string, withGit = true): string {
  const dir = join(TEST_HOME, name);
  mkdirSync(dir, { recursive: true });
  if (withGit) mkdirSync(join(dir, '.git'), { recursive: true });
  return dir;
}

/** Answer `git remote get-url origin` with this URL, or fail if null. */
function withOrigin(url: string | null): void {
  execFileMock.mockImplementation((cmd: string, args: string[], opts: unknown, cb: Function) => {
    if (args[0] === 'remote' && url) cb(null, { stdout: `${url}\n`, stderr: '' });
    else cb(new Error('no origin'));
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
  execFileMock.mockReset();
  getMainWorkspaceMock.mockReset();
  getMainWorkspaceMock.mockReturnValue(null);
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('resolveProjectCreateRecovery', () => {
  it('reports completed only when path, disk, and main workspace all agree', async () => {
    const dir = makeRepo('good');
    registerAt('good', dir);
    getMainWorkspaceMock.mockReturnValue({ id: 'ws-1', path: dir });

    const outcome = await resolveProjectCreateRecovery({
      key: 'good',
      expectedPath: dir,
      mode: 'new',
    });

    expect(outcome).toMatchObject({ status: 'completed', key: 'good', mainWorkspaceId: 'ws-1' });
  });

  it('does NOT call a key-only match a success', async () => {
    // The exact bug: an unrelated project happens to carry the expected key.
    const unrelated = makeRepo('unrelated');
    const expectedPath = join(TEST_HOME, 'what-we-asked-for');
    mkdirSync(expectedPath, { recursive: true });
    registerAt('widget', unrelated);
    getMainWorkspaceMock.mockReturnValue({ id: 'ws-1', path: unrelated });

    const outcome = await resolveProjectCreateRecovery({
      key: 'widget',
      expectedPath,
      mode: 'new',
    });

    expect(outcome.status).toBe('conflict');
  });

  it('reports needs-setup when the project is registered but has no main workspace', async () => {
    const dir = makeRepo('partial');
    registerAt('partial', dir);
    getMainWorkspaceMock.mockReturnValue(null);

    const outcome = await resolveProjectCreateRecovery({
      key: 'partial',
      expectedPath: dir,
      mode: 'new',
    });

    expect(outcome).toMatchObject({ status: 'needs-setup', key: 'partial', path: dir });
  });

  it('reports a conflict when the main workspace points somewhere else', async () => {
    const dir = makeRepo('drifted');
    registerAt('drifted', dir);
    getMainWorkspaceMock.mockReturnValue({ id: 'ws-1', path: join(TEST_HOME, 'elsewhere') });

    const outcome = await resolveProjectCreateRecovery({
      key: 'drifted',
      expectedPath: dir,
      mode: 'new',
    });

    expect(outcome.status).toBe('conflict');
  });

  it('reports unknown when nothing is registered, rather than inviting a retry', async () => {
    const outcome = await resolveProjectCreateRecovery({
      key: 'never-made',
      expectedPath: join(TEST_HOME, 'never-made'),
      mode: 'clone',
    });

    // Unknown, not failed: a clone may still be running in a process we cannot see.
    expect(outcome.status).toBe('unknown');
  });

  it('reports a conflict when the registered path is not on disk', async () => {
    const missing = join(TEST_HOME, 'vanished');
    registerAt('vanished', missing);
    getMainWorkspaceMock.mockReturnValue({ id: 'ws-1', path: missing });

    const outcome = await resolveProjectCreateRecovery({
      key: 'vanished',
      expectedPath: missing,
      mode: 'new',
    });

    expect(outcome.status).toBe('conflict');
  });

  describe('clone identity (FR-17)', () => {
    it('accepts a clone whose origin matches the requested repository', async () => {
      const dir = makeRepo('cloned');
      registerAt('cloned', dir);
      getMainWorkspaceMock.mockReturnValue({ id: 'ws-1', path: dir });
      withOrigin('git@github.com:acme/cloned.git');

      const outcome = await resolveProjectCreateRecovery({
        key: 'cloned',
        expectedPath: dir,
        mode: 'clone',
        expectedRepoSlug: 'acme/cloned',
      });

      expect(outcome.status).toBe('completed');
    });

    it('rejects a folder that points at a different repository', async () => {
      const dir = makeRepo('cloned');
      registerAt('cloned', dir);
      getMainWorkspaceMock.mockReturnValue({ id: 'ws-1', path: dir });
      withOrigin('git@github.com:someone/else.git');

      const outcome = await resolveProjectCreateRecovery({
        key: 'cloned',
        expectedPath: dir,
        mode: 'clone',
        expectedRepoSlug: 'acme/cloned',
      });

      expect(outcome.status).toBe('conflict');
    });

    it('rejects a same-named folder that is not a clone at all', async () => {
      const dir = makeRepo('cloned', false);
      registerAt('cloned', dir);
      getMainWorkspaceMock.mockReturnValue({ id: 'ws-1', path: dir });
      withOrigin(null);

      const outcome = await resolveProjectCreateRecovery({
        key: 'cloned',
        expectedPath: dir,
        mode: 'clone',
        expectedRepoSlug: 'acme/cloned',
      });

      expect(outcome.status).toBe('conflict');
    });
  });

  it('never mutates anything it inspects', async () => {
    const dir = makeRepo('readonly');
    registerAt('readonly', dir);
    getMainWorkspaceMock.mockReturnValue(null);

    await resolveProjectCreateRecovery({ key: 'readonly', expectedPath: dir, mode: 'new' });

    // Only read-only git plumbing may run; no clone, init, or worktree command.
    for (const call of execFileMock.mock.calls) {
      expect(['remote', 'rev-parse', 'symbolic-ref']).toContain(call[1][0]);
    }
  });
});
