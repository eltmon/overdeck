/**
 * Cross-process file lock for Session Vault state (PAN-2609).
 *
 * Every `pan vault` process (Stop hooks, `save`, `sync`, the dashboard timer)
 * shares one git clone, one local index, one allow-list and one eviction
 * batch. Each of those is read-modify-write, so two processes without a lock
 * can revert each other's writes. `withFileLock` takes an O_EXCL lock file,
 * runs `fn`, and removes the lock; a lock older than `staleMs` is treated as
 * abandoned (a crashed process) and reclaimed. Imports only Node built-ins.
 *
 * PAN-5648 (r4672667704 part b): the lock file holds a per-acquisition token
 * (`${pid} ${uuid}\n`), not just a pid. Release reads the file back and
 * removes it only when its content still equals the token this acquisition
 * wrote, so a holder whose lock was reclaimed as stale (or whose `fn` deleted
 * or overwrote the file) never deletes a lock another process now owns.
 */
import { randomUUID } from 'node:crypto';
import { open, readFile, rm, stat } from 'node:fs/promises';

export interface FileLockOptions {
  /** Reclaim a lock file older than this (a crashed holder). */
  staleMs?: number;
  /** Delay between acquisition attempts. */
  retryMs?: number;
  /** Give up after this many attempts. */
  maxAttempts?: number;
  /** Names the process family in the timeout message (PAN-5452); defaults to 'pan vault'. */
  label?: string;
  /** Give up after this long, measured with Date.now() (PAN-5461). */
  timeoutMs?: number;
}

/** Thrown when the lock could not be acquired within the attempt or time budget. */
export class FileLockTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockTimeoutError';
  }
}

export const DEFAULT_LOCK_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 15;
const DEFAULT_MAX_ATTEMPTS = 4_000; // about 60 s at the default retry

/** Returns the token this acquisition wrote, so release can verify it still owns the lock. */
async function acquire(lockPath: string, options: FileLockOptions): Promise<string> {
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const deadline = options.timeoutMs === undefined ? Infinity : Date.now() + options.timeoutMs;
  const token = `${process.pid} ${randomUUID()}\n`;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(token);
      await handle.close();
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > staleMs) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  throw new FileLockTimeoutError(`Could not acquire lock ${lockPath}; another ${options.label ?? 'pan vault'} process may be stuck`);
}

/** Removes `lockPath` only while its content still equals `token` — never a lock another holder now owns. */
async function release(lockPath: string, token: string): Promise<void> {
  const current = await readFile(lockPath, 'utf-8').catch(() => null);
  if (current === token) await rm(lockPath, { force: true });
}

/** Run `fn` while holding the O_EXCL lock at `lockPath`. Not reentrant. */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  const token = await acquire(lockPath, options);
  try {
    return await fn();
  } finally {
    await release(lockPath, token);
  }
}
