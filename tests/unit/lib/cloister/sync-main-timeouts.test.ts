import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.hoisted(() =>
  vi.fn<[string, Record<string, unknown>?], Promise<{ stdout: string; stderr: string }>>()
);
const operationHeads = vi.hoisted(() => new Set<string>());
const operationHeadErrors = vi.hoisted(() => new Map<string, Error>());
const cleanupStaleLocksMock = vi.hoisted(() => vi.fn());

const operationHeadFromCommand = (command: string) =>
  command.match(/git rev-parse -q --verify (MERGE_HEAD|REBASE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD)/)?.[1];

vi.mock('child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(command: string, optionsOrCallback: unknown, maybeCallback?: unknown) {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    const operationHead = operationHeadFromCommand(command);
    if (operationHead) {
      const error = operationHeadErrors.get(operationHead);
      if (error) (callback as (error: Error) => void)(error);
      else if (operationHeads.has(operationHead)) {
        (callback as (error: null, stdout: string, stderr: string) => void)(null, 'deadbeef\n', '');
      } else {
        (callback as (error: Error) => void)(Object.assign(new Error('ref not found'), { code: 1 }));
      }
      return { pid: 4242, kill: vi.fn() };
    }
    execMock(command, typeof optionsOrCallback === 'object' ? optionsOrCallback as Record<string, unknown> : undefined)
      .then(({ stdout, stderr }) => (callback as (error: null, stdout: string, stderr: string) => void)(null, stdout, stderr))
      .catch((error) => (callback as (error: unknown, stdout: string, stderr: string) => void)(error, '', ''));
    return { pid: 4242, kill: vi.fn() };
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
    const operationHead = operationHeadFromCommand(command);
    if (operationHead) {
      const error = operationHeadErrors.get(operationHead);
      if (error) return Promise.reject(error);
      return operationHeads.has(operationHead)
        ? Promise.resolve({ stdout: 'deadbeef\n', stderr: '' })
        : Promise.reject(Object.assign(new Error('ref not found'), { code: 1 }));
    }
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
  cleanupStaleLocks: cleanupStaleLocksMock,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, appendFileSync: vi.fn() };
});

import {
  autoCommitWorkspaceChangesBeforeSync,
  syncMainIntoWorkspace,
} from '../../../../src/lib/cloister/merge-agent.js';
import {
  ensureSyncGitQuiescent,
  probeGitOperationHeads,
  runSyncGitCommand,
  SyncGitCommandAbortError,
  UnsafeSyncMainStateError,
} from '../../../../src/lib/cloister/sync-main-git.js';

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
    operationHeads.clear();
    operationHeadErrors.clear();
    cleanupStaleLocksMock.mockReturnValue(Effect.succeed({ found: [], removed: [], errors: [] }));
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
      if (command === 'git merge origin/main') {
        operationHeads.add('MERGE_HEAD');
        throw timeoutError();
      }
      if (command === 'git merge --abort') operationHeads.delete('MERGE_HEAD');
      return { stdout: '', stderr: '' };
    });

    const result = await syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID);

    expect(result).toEqual({
      success: false,
      reason: 'git merge origin/main timed out after 120s',
    });
    const mergeAbortOptions = execMock.mock.calls
      .find(([command]) => command === 'git merge --abort')?.[1];
    expect(mergeAbortOptions).toEqual(expect.objectContaining({ timeout: expect.any(Number) }));
    const mergeAbortTimeout = mergeAbortOptions?.timeout as number;
    expect(mergeAbortTimeout).toBeGreaterThan(0);
    expect(mergeAbortTimeout).toBeLessThanOrEqual(30_000);
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

  it('treats exit code 1 as an absent operation ref', async () => {
    await expect(probeGitOperationHeads(PROJECT_PATH, 30_000)).resolves.toEqual({
      success: true,
      present: [],
    });
  });

  it('returns a named failure when an operation-head probe times out', async () => {
    operationHeadErrors.set('MERGE_HEAD', timeoutError());

    await expect(probeGitOperationHeads(PROJECT_PATH, 30_000)).resolves.toEqual({
      success: false,
      present: [],
      reason: 'MERGE_HEAD probe timed out after 30s',
    });
  });

  it('fails closed without mutating Git when an operation-head probe is inconclusive', async () => {
    operationHeadErrors.set('MERGE_HEAD', new Error('rev-parse failed'));

    await expect(autoCommitWorkspaceChangesBeforeSync(PROJECT_PATH, ISSUE_ID)).resolves.toEqual({
      success: false,
      committed: false,
      reason: 'MERGE_HEAD probe failed: rev-parse failed',
    });
    expect(execMock).not.toHaveBeenCalledWith('git status --porcelain', expect.anything());

    await expect(syncMainIntoWorkspace(PROJECT_PATH, ISSUE_ID)).resolves.toMatchObject({
      success: false,
      reason: 'MERGE_HEAD probe failed: rev-parse failed',
    });
    expect(execMock).not.toHaveBeenCalledWith('git fetch origin main', expect.anything());
    expect(execMock).not.toHaveBeenCalledWith('git merge origin/main', expect.anything());
  });

  it('kills an aborted command tree and waits for its callback before rejecting', async () => {
    let finishCommand!: (value: { stdout: string; stderr: string }) => void;
    execMock.mockImplementation(() => new Promise((resolve) => { finishCommand = resolve; }));
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const controller = new AbortController();
    let settled = false;
    const commandPromise = runSyncGitCommand('git fetch origin main', {
      cwd: PROJECT_PATH,
      timeout: 60_000,
      signal: controller.signal,
    });
    const rejection = expect(commandPromise).rejects.toBeInstanceOf(SyncGitCommandAbortError);
    void commandPromise.then(() => { settled = true; }, () => { settled = true; });

    controller.abort();
    await Promise.resolve();

    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
    expect(settled).toBe(false);
    finishCommand({ stdout: '', stderr: '' });
    await rejection;
    expect(settled).toBe(true);
    killSpy.mockRestore();
  });

  it('gives stale-lock probes a fresh bounded cleanup signal', async () => {
    vi.useFakeTimers();
    try {
      let cleanupOptions: {
        signal?: AbortSignal;
        processProbeTimeoutMs?: number;
      } | undefined;
      let finishCleanup!: () => void;
      cleanupStaleLocksMock.mockImplementation((
        _projectPath: string,
        options: typeof cleanupOptions,
      ) => {
        cleanupOptions = options;
        return Effect.promise(() => new Promise((resolve) => {
          finishCleanup = () => resolve({
            found: [`${PROJECT_PATH}/.git/index.lock`],
            removed: [],
            errors: [{ file: 'N/A', error: 'process probe cancelled' }],
          });
          options?.signal?.addEventListener('abort', finishCleanup, { once: true });
        }));
      });

      const cleanupPromise = ensureSyncGitQuiescent(PROJECT_PATH, false, 1_000);
      const rejection = expect(cleanupPromise).rejects.toMatchObject({
        name: 'UnsafeSyncMainStateError',
        message: expect.stringContaining('Could not establish Git quiescence'),
      });
      await Promise.resolve();

      expect(cleanupOptions?.signal?.aborted).toBe(false);
      expect(cleanupOptions?.processProbeTimeoutMs).toBe(1_000);

      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;

      expect(cleanupOptions?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares one cleanup deadline across lock and operation probes', async () => {
    vi.useFakeTimers();
    try {
      cleanupStaleLocksMock.mockReturnValue(Effect.promise(() => new Promise((resolve) => {
        setTimeout(() => resolve({ found: [], removed: [], errors: [] }), 700);
      })));
      operationHeads.add('MERGE_HEAD');
      let finishAbort!: (value: { stdout: string; stderr: string }) => void;
      execMock.mockImplementation(() => new Promise((resolve) => {
        finishAbort = resolve;
      }));
      let settled = false;
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const cleanupPromise = ensureSyncGitQuiescent(PROJECT_PATH, true, 1_000);
      const rejection = expect(cleanupPromise).rejects.toBeInstanceOf(UnsafeSyncMainStateError);
      void cleanupPromise.then(() => { settled = true; }, () => { settled = true; });

      await vi.advanceTimersByTimeAsync(700);
      const abortCall = execMock.mock.calls.find(([command]) =>
        command === 'git merge --abort');
      expect(abortCall?.[1]?.timeout).toBe(300);

      await vi.advanceTimersByTimeAsync(300);
      expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL');
      expect(settled).toBe(false);

      finishAbort({ stdout: '', stderr: '' });
      await rejection;
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      killSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails fast when cleanup cannot positively establish quiescence', async () => {
    operationHeads.add('MERGE_HEAD');

    await expect(ensureSyncGitQuiescent(PROJECT_PATH, true)).rejects.toEqual(
      expect.objectContaining({
        name: 'UnsafeSyncMainStateError',
        message: 'Git operation remains active after cleanup: MERGE_HEAD',
      } satisfies Partial<UnsafeSyncMainStateError>),
    );
  });
});
