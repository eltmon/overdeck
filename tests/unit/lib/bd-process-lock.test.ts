import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BdProcessLockError,
  BdTransientFailure,
  acquireBdProcessLock,
  bdProcessLockPath,
  isTransientBdError,
  readBdProcessLockHolder,
  resolveSharedBeadsDir,
  runBdWithRetry,
  withBdProcessLock,
} from '../../../src/lib/bd-process-lock.js';

const originalPanopticonHome = process.env.PANOPTICON_HOME;
let testRoot: string;
let panopticonHome: string;
let workspacePath: string;

function lockPath(): Promise<string> {
  return bdProcessLockPath(workspacePath);
}

function writeLock(path: string, holder: { pid: number; ts: number; caller: string }) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(holder)}\n`, 'utf8');
}

describe('isTransientBdError', () => {
  it('returns true for embedded Dolt database lock stderr', () => {
    expect(isTransientBdError({ stderr: 'database is locked' })).toBe(true);
  });

  it('returns true for execFile message strings that include lock contention', () => {
    const error = new Error(
      'Command failed: bd list --json -l pan-1629 --status all --limit 0\nresource temporarily unavailable',
    );

    expect(isTransientBdError(error)).toBe(true);
  });

  it('returns true for execFile-style lock acquisition stderr', () => {
    expect(
      isTransientBdError({
        stderr: 'could not acquire database lock: lock held by another process',
        code: 1,
      }),
    ).toBe(true);
  });

  it('returns true for transient errno codes from child process failures', () => {
    expect(isTransientBdError({ code: 'EAGAIN' })).toBe(true);
    expect(isTransientBdError({ cause: { code: 'EBUSY' } })).toBe(true);
  });

  it('returns false for successful-but-empty bd list results', () => {
    expect(isTransientBdError({ stdout: '[]', stderr: '', code: 0 })).toBe(false);
    expect(isTransientBdError('[]')).toBe(false);
  });

  it('returns false for genuine fatal errors', () => {
    expect(isTransientBdError({ stderr: 'corrupt database: invalid chunk table', code: 1 })).toBe(false);
    expect(isTransientBdError({ message: 'spawn bd ENOENT', code: 'ENOENT' })).toBe(false);
    expect(isTransientBdError(new Error('planning must create beads'))).toBe(false);
  });
});

describe('bd process lock', () => {
  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'pan-bd-process-lock-'));
    panopticonHome = join(testRoot, 'home');
    workspacePath = join(testRoot, 'workspace');
    mkdirSync(join(workspacePath, '.beads'), { recursive: true });
    process.env.PANOPTICON_HOME = panopticonHome;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPanopticonHome === undefined) {
      delete process.env.PANOPTICON_HOME;
    } else {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    }
    rmSync(testRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('derives the same lock path from worktrees that redirect to the same shared .beads dir', async () => {
    const mainWorkspace = join(testRoot, 'main');
    const featureWorkspace = join(testRoot, 'workspaces', 'feature-pan-1629');
    mkdirSync(join(mainWorkspace, '.beads'), { recursive: true });
    mkdirSync(join(featureWorkspace, '.beads'), { recursive: true });
    writeFileSync(join(featureWorkspace, '.beads', 'redirect'), '../../../main/.beads\n', 'utf8');

    await expect(resolveSharedBeadsDir(featureWorkspace)).resolves.toBe(join(mainWorkspace, '.beads'));
    await expect(bdProcessLockPath(featureWorkspace)).resolves.toBe(await bdProcessLockPath(mainWorkspace));
  });

  it('acquires and releases the lock in finally when the operation throws', async () => {
    const path = await lockPath();

    await expect(withBdProcessLock('throwing caller', async () => {
      throw new Error('boom');
    }, { workspacePath })).rejects.toThrow('boom');

    expect(existsSync(path)).toBe(false);
  });

  it('does not allow two simulated separate holders to hold the lock at once', async () => {
    const first = await acquireBdProcessLock('first caller', { workspacePath });

    await expect(
      acquireBdProcessLock('second caller', { workspacePath, acquisitionTimeoutMs: 0 }),
    ).rejects.toBeInstanceOf(BdProcessLockError);
    expect(await readBdProcessLockHolder({ workspacePath })).toMatchObject({ caller: 'first caller' });

    await first.release();
  });

  it('reclaims stale locks by dead PID or age and respects live holders', async () => {
    const path = await lockPath();
    writeLock(path, { pid: 999_999_999, ts: Date.now(), caller: 'dead holder' });
    const deadPidHandle = await acquireBdProcessLock('dead pid reclaimer', { workspacePath });
    expect(deadPidHandle.holder.caller).toBe('dead pid reclaimer');
    await deadPidHandle.release();

    writeLock(path, { pid: process.pid, ts: Date.now() - 301_000, caller: 'old holder' });
    const oldHandle = await acquireBdProcessLock('old lock reclaimer', { workspacePath, staleLockMs: 300_000 });
    expect(oldHandle.holder.caller).toBe('old lock reclaimer');
    await oldHandle.release();

    writeLock(path, { pid: process.pid, ts: Date.now(), caller: 'live holder' });
    await expect(
      acquireBdProcessLock('blocked caller', { workspacePath, acquisitionTimeoutMs: 0 }),
    ).rejects.toMatchObject({ holder: expect.objectContaining({ caller: 'live holder' }) });
  });

  it('bounds acquisition wait for a wedged live holder', async () => {
    const path = await lockPath();
    writeLock(path, { pid: process.pid, ts: Date.now(), caller: 'wedged holder' });

    await expect(
      acquireBdProcessLock('blocked caller', { workspacePath, acquisitionTimeoutMs: 0 }),
    ).rejects.toMatchObject({ operation: 'acquireBdProcessLock' });
  });

  it('retries transient bd failures with fake-timer backoff', async () => {
    vi.useFakeTimers();
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ stderr: 'database is locked' })
      .mockRejectedValueOnce({ message: 'resource temporarily unavailable' })
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();

    const resultPromise = runBdWithRetry('retry caller', operation, {
      workspacePath,
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
      onRetry,
    });

    await expect(resultPromise).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('surfaces a typed transient failure after bounded retry attempts', async () => {
    vi.useFakeTimers();
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue({ stderr: 'database is locked' });

    const resultPromise = runBdWithRetry('exhausted caller', operation, {
      workspacePath,
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 100,
      random: () => 0,
      sleep: (ms) => vi.advanceTimersByTimeAsync(ms),
    });

    await expect(resultPromise).rejects.toBeInstanceOf(BdTransientFailure);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
