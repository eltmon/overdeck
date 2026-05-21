import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Data, Effect } from 'effect';
import { getPanopticonHome } from './paths.js';

export type RestartLockHolder = {
  pid: number;
  ts: number;
  caller: string;
};

export type RestartLockHandle = {
  release(): Promise<void>;
};

const STALE_LOCK_MS = 5 * 60 * 1000;

function restartLockPath(): string {
  return join(getPanopticonHome(), 'restart.lock');
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function readHolderFromPath(path: string): Promise<RestartLockHolder | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<RestartLockHolder>;
    if (
      typeof parsed.pid !== 'number' ||
      !Number.isFinite(parsed.pid) ||
      typeof parsed.ts !== 'number' ||
      !Number.isFinite(parsed.ts) ||
      typeof parsed.caller !== 'string'
    ) {
      return null;
    }
    return { pid: parsed.pid, ts: parsed.ts, caller: parsed.caller };
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null;
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === 'EPERM';
  }
}

function isStale(holder: RestartLockHolder, now: number): boolean {
  return now - holder.ts > STALE_LOCK_MS || !isProcessAlive(holder.pid);
}

async function writeLockFile(path: string, holder: RestartLockHolder): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(holder)}\n`, 'utf8');
  } finally {
    await file.close();
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
  }
}

function matchesHolder(actual: RestartLockHolder | null, expected: RestartLockHolder): boolean {
  return actual?.pid === expected.pid && actual.ts === expected.ts && actual.caller === expected.caller;
}

async function acquireStaleBreaker(path: string): Promise<RestartLockHandle | null> {
  const breakerPath = `${path}.break`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const holder = { pid: process.pid, ts: Date.now(), caller: 'stale restart lock breaker' };
    try {
      await writeLockFile(breakerPath, holder);
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          if (matchesHolder(await readHolderFromPath(breakerPath), holder)) {
            await unlinkIfExists(breakerPath);
          }
        },
      };
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;
      const existing = await readHolderFromPath(breakerPath);
      if (!existing || !isStale(existing, Date.now())) return null;
      await unlinkIfExists(breakerPath);
    }
  }
  return null;
}

export async function readRestartLockHolder(): Promise<RestartLockHolder | null> {
  return readHolderFromPath(restartLockPath());
}

export async function acquireRestartLock(caller: string): Promise<RestartLockHandle | null> {
  const path = restartLockPath();
  await mkdir(dirname(path), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const holder = { pid: process.pid, ts: Date.now(), caller };
    try {
      await writeLockFile(path, holder);
      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          if (matchesHolder(await readHolderFromPath(path), holder)) {
            await unlinkIfExists(path);
          }
        },
      };
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;
      const breaker = await acquireStaleBreaker(path);
      if (!breaker) return null;
      try {
        const existing = await readHolderFromPath(path);
        if (existing && !isStale(existing, Date.now())) return null;
        await unlinkIfExists(path);
      } finally {
        await breaker.release();
      }
    }
  }

  return null;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Tagged error for restart-lock Effect variants. */
export class RestartLockError extends Data.TaggedError('RestartLockError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `readRestartLockHolder`. */
export const readRestartLockHolderEffect = (): Effect.Effect<RestartLockHolder | null, RestartLockError> =>
  Effect.tryPromise({
    try: () => readRestartLockHolder(),
    catch: (cause) =>
      new RestartLockError({
        operation: 'readRestartLockHolder',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `acquireRestartLock`. */
export const acquireRestartLockEffect = (
  caller: string,
): Effect.Effect<RestartLockHandle | null, RestartLockError> =>
  Effect.tryPromise({
    try: () => acquireRestartLock(caller),
    catch: (cause) =>
      new RestartLockError({
        operation: 'acquireRestartLock',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
