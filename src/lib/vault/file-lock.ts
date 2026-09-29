/**
 * Cross-process file lock for Session Vault state (PAN-2609).
 *
 * Every `pan vault` process (Stop hooks, `save`, `sync`, the dashboard timer)
 * shares one git clone, one local index, one allow-list and one eviction
 * batch. Each of those is read-modify-write, so two processes without a lock
 * can revert each other's writes. `withFileLock` takes an O_EXCL lock file,
 * runs `fn`, and removes the lock; a lock older than `staleMs` is treated as
 * abandoned (a crashed process) and reclaimed. Imports only Node built-ins.
 */
import { open, rm, stat } from 'node:fs/promises';

export interface FileLockOptions {
  /** Reclaim a lock file older than this (a crashed holder). */
  staleMs?: number;
  /** Delay between acquisition attempts. */
  retryMs?: number;
  /** Give up after this many attempts. */
  maxAttempts?: number;
}

export const DEFAULT_LOCK_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 15;
const DEFAULT_MAX_ATTEMPTS = 4_000; // about 60 s at the default retry

async function acquire(lockPath: string, options: FileLockOptions): Promise<void> {
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > staleMs) {
        await rm(lockPath, { force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  throw new Error(`Could not acquire lock ${lockPath}; another pan vault process may be stuck`);
}

/** Run `fn` while holding the O_EXCL lock at `lockPath`. Not reentrant. */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  await acquire(lockPath, options);
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}
