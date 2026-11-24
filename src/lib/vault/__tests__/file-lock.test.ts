// Real timers on purpose (PAN-5461 NFR-3): fake timers over real fs calls race
// on busy CI runners, so every bound here is tiny (total well under 100 ms).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileLockTimeoutError, withFileLock } from '../file-lock.js';

describe('withFileLock timeouts (PAN-5461 WI-2a)', () => {
  let root: string;
  let lockPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pan-5461-lock-'));
    lockPath = join(root, 'lock');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('gives up after timeoutMs with FileLockTimeoutError and never calls fn', async () => {
    await writeFile(lockPath, '1\n');
    const fn = vi.fn(async () => 'ran');
    const error = await withFileLock(lockPath, fn, { retryMs: 1, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileLockTimeoutError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(`Could not acquire lock ${lockPath}`);
    expect(fn).not.toHaveBeenCalled();
    expect(existsSync(lockPath)).toBe(true);
  });

  it('throws FileLockTimeoutError when attempts run out without timeoutMs', async () => {
    await writeFile(lockPath, '1\n');
    const fn = vi.fn(async () => 'ran');
    await expect(withFileLock(lockPath, fn, { retryMs: 1, maxAttempts: 3 })).rejects.toBeInstanceOf(
      FileLockTimeoutError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs fn on a free lock and removes the lock file (PAN-5648 file-lock-owner.ac3)', async () => {
    const value = await withFileLock(lockPath, async () => {
      expect(existsSync(lockPath)).toBe(true);
      return 42;
    }, { retryMs: 1, timeoutMs: 20 });
    expect(value).toBe(42);
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('withFileLock release ownership (PAN-5648 file-lock-owner, CodeRabbit r4672667704 part b)', () => {
  let root: string;
  let lockPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pan-5648-lock-'));
    lockPath = join(root, 'lock');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('never deletes a lock fn overwrote with another holder\'s content (ac1)', async () => {
    await withFileLock(lockPath, async () => {
      await writeFile(lockPath, 'another-holder\n');
    }, { retryMs: 1, timeoutMs: 20 });

    expect(existsSync(lockPath)).toBe(true);
    await expect(readFile(lockPath, 'utf-8')).resolves.toBe('another-holder\n');
  });

  it('does not throw when fn deletes the lock file (ac2)', async () => {
    await expect(withFileLock(lockPath, async () => {
      await rm(lockPath, { force: true });
      return 'ran';
    }, { retryMs: 1, timeoutMs: 20 })).resolves.toBe('ran');
    expect(existsSync(lockPath)).toBe(false);
  });
});
