import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.hoisted(() =>
  vi.fn<[string, Record<string, unknown>?], Promise<{ stdout: string; stderr: string }>>()
);

const isOperationHeadCheck = (command: string) =>
  /git rev-parse -q --verify (?:MERGE_HEAD|REBASE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD)/.test(command);

vi.mock('child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(command: string, optionsOrCallback: unknown, maybeCallback?: unknown) {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    if (isOperationHeadCheck(command)) {
      (callback as (error: Error) => void)(new Error('ref not found'));
      return;
    }
    execMock(command, typeof optionsOrCallback === 'object' ? optionsOrCallback as Record<string, unknown> : undefined)
      .then(({ stdout, stderr }) => (callback as (error: null, stdout: string, stderr: string) => void)(null, stdout, stderr))
      .catch((error) => (callback as (error: unknown, stdout: string, stderr: string) => void)(error, '', ''));
  }

  function execFile(file: string, argsOrOptionsOrCallback: unknown, optionsOrCallback?: unknown, maybeCallback?: unknown) {
    const callback = typeof argsOrOptionsOrCallback === 'function'
      ? argsOrOptionsOrCallback
      : typeof optionsOrCallback === 'function'
        ? optionsOrCallback
        : maybeCallback;
    const args = Array.isArray(argsOrOptionsOrCallback) ? argsOrOptionsOrCallback.join(' ') : '';
    const command = args ? `${file} ${args}` : file;
    execMock(command, typeof optionsOrCallback === 'object' ? optionsOrCallback as Record<string, unknown> : undefined)
      .then(({ stdout, stderr }) => (callback as (error: null, stdout: string, stderr: string) => void)(null, stdout, stderr))
      .catch((error) => (callback as (error: unknown, stdout: string, stderr: string) => void)(error, '', ''));
  }

  (exec as unknown as Record<symbol, unknown>)[kCustom] = (command: string, options?: Record<string, unknown>) => {
    if (isOperationHeadCheck(command)) return Promise.reject(new Error('ref not found'));
    return execMock(command, options);
  };
  (execFile as unknown as Record<symbol, unknown>)[kCustom] = (
    file: string,
    args?: string[],
    options?: Record<string, unknown>,
  ) => execMock(Array.isArray(args) && args.length > 0 ? `${file} ${args.join(' ')}` : file, options);

  return { exec, execFile, spawn: vi.fn() };
});

vi.mock('../../../../src/lib/git-utils.js', () => ({
  cleanupStaleLocks: vi.fn().mockReturnValue(Effect.succeed({ found: [], removed: [], errors: [] })),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, appendFileSync: vi.fn() };
});

import {
  autoCommitWorkspaceChangesBeforeSync,
  syncMainIntoWorkspace,
} from '../../../../src/lib/cloister/merge-agent.js';

const PROJECT_PATH = '/tmp/pan-1897-sync-main';
const ISSUE_ID = 'PAN-1897';

function timeoutError(): Error & { killed: true } {
  return Object.assign(new Error('Command timed out'), { killed: true as const });
}

function noConflictMarkers(): Error & { code: number } {
  return Object.assign(new Error('no matches'), { code: 1 });
}

describe('sync-main git timeouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execMock.mockImplementation(async (command) => {
      if (command.startsWith('git grep ')) throw noConflictMarkers();
      return { stdout: '', stderr: '' };
    });
  });

  it('returns a named 60s failure when git fetch origin main times out', async () => {
    execMock.mockImplementation(async (command) => {
      if (command.startsWith('git grep ')) throw noConflictMarkers();
      if (command === 'git fetch origin main') throw timeoutError();
      return { stdout: '', stderr: '' };
    });

    const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

    expect(result).toEqual({
      success: false,
      reason: 'git fetch origin main timed out after 60s',
    });
    expect(execMock).toHaveBeenCalledWith(
      'git fetch origin main',
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  it('aborts and returns a named 120s failure when git merge times out', async () => {
    execMock.mockImplementation(async (command) => {
      if (command.startsWith('git grep ')) throw noConflictMarkers();
      if (command === 'git merge origin/main') throw timeoutError();
      return { stdout: '', stderr: '' };
    });

    const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

    expect(result).toEqual({
      success: false,
      reason: 'git merge origin/main timed out after 120s',
    });
    expect(execMock).toHaveBeenCalledWith(
      'git merge --abort',
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it('stops sync with a named failure when the auto-commit hook times out', async () => {
    execMock.mockImplementation(async (command) => {
      if (command.startsWith('git grep ')) throw noConflictMarkers();
      if (command === 'git status --porcelain') return { stdout: ' M src/file.ts\n', stderr: '' };
      if (command === 'git diff --cached --stat') return { stdout: ' src/file.ts | 1 +\n', stderr: '' };
      if (command.startsWith('git commit -m ')) throw timeoutError();
      return { stdout: '', stderr: '' };
    });

    const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

    expect(result).toEqual({
      success: false,
      reason: 'Auto-commit git commit timed out after 60s',
    });
    expect(execMock).not.toHaveBeenCalledWith('git fetch origin main', expect.anything());
  });

  it('passes an explicit timeout to every git exec in both sync functions', async () => {
    execMock.mockImplementation(async (command) => {
      if (command.startsWith('git grep ')) throw noConflictMarkers();
      if (command === 'git status --porcelain') return { stdout: ' M src/file.ts\n', stderr: '' };
      if (command === 'git diff --cached --stat') return { stdout: ' src/file.ts | 1 +\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });

    await autoCommitWorkspaceChangesBeforeSync(PROJECT_PATH, ISSUE_ID);

    for (const [command, options] of execMock.mock.calls) {
      expect(command).toMatch(/^git /);
      expect(options?.timeout, command).toEqual(expect.any(Number));
    }

    vi.clearAllMocks();
    execMock.mockImplementation(async (command) => {
      if (command.startsWith('git grep ')) throw noConflictMarkers();
      if (command === 'git merge origin/main') return { stdout: 'Already up to date.\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });

    await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

    for (const [command, options] of execMock.mock.calls) {
      expect(command).toMatch(/^git /);
      expect(options?.timeout, command).toEqual(expect.any(Number));
    }
  });
});
