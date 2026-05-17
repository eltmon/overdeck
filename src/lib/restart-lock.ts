import { constants, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getPanopticonHome } from './paths.js';

export type RestartLockHolder = {
  pid: number;
  ts: number;
  caller: string;
};

export type RestartLockHandle = {
  release(): void;
};

const STALE_LOCK_MS = 5 * 60 * 1000;

function restartLockPath(): string {
  return join(getPanopticonHome(), 'restart.lock');
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function readHolderFromPath(path: string): RestartLockHolder | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RestartLockHolder>;
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

function writeLockFile(path: string, holder: RestartLockHolder): void {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(holder)}\n`, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function acquireStaleBreaker(path: string): RestartLockHandle | null {
  const breakerPath = `${path}.break`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const holder = { pid: process.pid, ts: Date.now(), caller: 'stale restart lock breaker' };
    try {
      writeLockFile(breakerPath, holder);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          try {
            if (matchesHolder(readHolderFromPath(breakerPath), holder)) {
              unlinkSync(breakerPath);
            }
          } catch (error) {
            if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
          }
        },
      };
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;
      const existing = readHolderFromPath(breakerPath);
      if (!existing || !isStale(existing, Date.now())) return null;
      try {
        unlinkSync(breakerPath);
      } catch (unlinkError) {
        if (!isErrnoException(unlinkError) || unlinkError.code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  return null;
}

function matchesHolder(actual: RestartLockHolder | null, expected: RestartLockHolder): boolean {
  return actual?.pid === expected.pid && actual.ts === expected.ts && actual.caller === expected.caller;
}

export function readRestartLockHolder(): RestartLockHolder | null {
  return readHolderFromPath(restartLockPath());
}

export function acquireRestartLock(caller: string): RestartLockHandle | null {
  const path = restartLockPath();
  mkdirSync(dirname(path), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const holder = { pid: process.pid, ts: Date.now(), caller };
    try {
      writeLockFile(path, holder);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          try {
            if (matchesHolder(readHolderFromPath(path), holder)) {
              unlinkSync(path);
            }
          } catch (error) {
            if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
          }
        },
      };
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;
      const breaker = acquireStaleBreaker(path);
      if (!breaker) return null;
      try {
        const existing = readHolderFromPath(path);
        if (existing && !isStale(existing, Date.now())) return null;
        if (existing) {
          try {
            unlinkSync(path);
          } catch (unlinkError) {
            if (!isErrnoException(unlinkError) || unlinkError.code !== 'ENOENT') throw unlinkError;
          }
        }
      } finally {
        breaker.release();
      }
    }
  }

  return null;
}
