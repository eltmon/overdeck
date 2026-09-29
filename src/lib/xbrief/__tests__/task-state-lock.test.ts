import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskStateLockPath, withTaskStateLock, TaskStateLockTimeout } from '../task-state-lock.js';

describe('withTaskStateLock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'task-state-lock-'));
    lockPath = join(dir, 'overdeck-task-state.lock');
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs fn and removes the lock file afterwards', async () => {
    const result = await withTaskStateLock(lockPath, async () => {
      expect(existsSync(lockPath)).toBe(true);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('removes the lock file even when fn throws', async () => {
    await expect(
      withTaskStateLock(lockPath, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('waits for a lock held by a live pid, then times out naming the holder pid', async () => {
    vi.useFakeTimers();
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, acquiredAt: new Date().toISOString() }));

    let settled = false;
    const promise = withTaskStateLock(lockPath, async () => 'unreachable', {
      timeoutMs: 1000,
      pollMs: 100,
      isPidAlive: () => true,
    });
    const captured = promise.then(
      () => {
        settled = true;
        return null;
      },
      (err: unknown) => {
        settled = true;
        return err;
      },
    );

    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(600);
    const error = await captured;
    expect(settled).toBe(true);
    expect(error).toBeInstanceOf(TaskStateLockTimeout);
    expect(String((error as Error).message)).toContain('999999');
  });

  it('breaks a lock naming a dead pid immediately and runs fn', async () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, acquiredAt: new Date().toISOString() }));
    const result = await withTaskStateLock(lockPath, async () => 'ok', { isPidAlive: () => false });
    expect(result).toBe('ok');
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('taskStateLockPath', () => {
  it('resolves to a path under .git/ that git status never reports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-state-lock-repo-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });

      const lockPath = await taskStateLockPath(dir);
      expect(lockPath).toContain('/.git/');

      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();
      expect(status.trim()).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a plain-English error when planHome is not a git checkout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-state-lock-nongit-'));
    try {
      await expect(taskStateLockPath(dir)).rejects.toThrow(/git checkout/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
