/**
 * Task-state lock (PAN-4339, W2): serializes every `pan task` writing verb
 * (claim, done, block, unblock, reopen, cancel) across its continue-file
 * read-modify-write AND its `commitContinue`, so two concurrent `pan task`
 * processes racing on the same continue file and the same git index don't
 * lose an update or corrupt the index.
 *
 * The lock lives in the plan home's own git dir
 * (`git rev-parse --git-path overdeck-task-state.lock`), never under
 * `.overdeck/` or `.pan/`: the repo's `.gitignore` lists specific `.overdeck/`
 * files rather than the directory, so a lock file there would show as `??` in
 * `git status` while held (and forever after a crash). The git dir is also
 * exactly the index the lock protects.
 *
 * No lease, TTL, or heartbeat — a lock is stale only when its recorded pid is
 * confirmed not running, or its content is unreadable and old enough that it
 * looks abandoned mid-write.
 */

import { execFile } from 'node:child_process';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_MS = 100;
/** A lock file whose content can't be parsed is stale once it's older than this — otherwise it may just be mid-write. */
const STALE_UNREADABLE_MS = 5_000;

export interface TaskStateLockOptions {
  /** Give up and throw after this many milliseconds. Default 60_000. */
  timeoutMs?: number;
  /** Poll interval while waiting for a live holder to release. Default 100. */
  pollMs?: number;
  /** Liveness probe for a holder pid. Default: `process.kill(pid, 0)`, ESRCH ⇒ false, EPERM ⇒ true. */
  isPidAlive?: (pid: number) => boolean;
}

export class TaskStateLockTimeout extends Error {}

interface LockHolder {
  pid: number;
  acquiredAt: string;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === 'EPERM';
  }
}

/**
 * `git rev-parse --git-path overdeck-task-state.lock`, run in `planHome` and
 * resolved against it. Throws a plain-English error when `planHome` is not a
 * git checkout.
 */
export async function taskStateLockPath(planHome: string): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--git-path', 'overdeck-task-state.lock'],
      { cwd: planHome },
    ));
  } catch {
    throw new Error(`${planHome} is not a git checkout — cannot resolve the task-state lock path.`);
  }
  return resolve(planHome, stdout.trim());
}

async function readHolder(path: string): Promise<LockHolder | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<LockHolder>;
    if (typeof parsed.pid !== 'number' || !Number.isFinite(parsed.pid)) return null;
    return { pid: parsed.pid, acquiredAt: typeof parsed.acquiredAt === 'string' ? parsed.acquiredAt : '' };
  } catch {
    return null;
  }
}

/** D12: a recorded-dead pid is stale; unreadable content is stale only once it's old enough to look abandoned. */
async function isStaleLock(path: string, isPidAlive: (pid: number) => boolean): Promise<boolean> {
  const holder = await readHolder(path);
  if (holder) return !isPidAlive(holder.pid);
  try {
    const info = await stat(path);
    return Date.now() - info.mtimeMs > STALE_UNREADABLE_MS;
  } catch {
    // Vanished between the EEXIST and this check — nothing left to break.
    return true;
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
  }
}

/**
 * Acquire the task-state lock at `lockPath`, run `fn`, and release it.
 *
 * Acquire: `open(lockPath, 'wx')` writing `{pid, acquiredAt}`. On `EEXIST`,
 * break the lock immediately when it's stale, otherwise wait `pollMs` and
 * retry until `timeoutMs` elapses, then throw {@link TaskStateLockTimeout}
 * naming the holder pid. Release in `finally`, and only when the lock file
 * still names this call's own pid (a lock this call already lost to a
 * stale-breaker must not be unlinked out from under its new holder).
 */
export async function withTaskStateLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: TaskStateLockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;

  const holder: LockHolder = { pid: process.pid, acquiredAt: new Date().toISOString() };
  const start = Date.now();

  for (;;) {
    try {
      const file = await open(lockPath, 'wx');
      try {
        await file.writeFile(`${JSON.stringify(holder)}\n`, 'utf8');
      } finally {
        await file.close();
      }
      break;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'EEXIST') throw error;

      if (await isStaleLock(lockPath, isPidAlive)) {
        await unlinkIfExists(lockPath);
        continue;
      }

      if (Date.now() - start >= timeoutMs) {
        const existing = await readHolder(lockPath);
        const holderPid = existing?.pid ?? 'unknown';
        throw new TaskStateLockTimeout(
          `Another pan task command (pid ${holderPid}) has held the task-state lock for ` +
            `${Math.round(timeoutMs / 1000)}s. If that process is hung, stop it and run this again.`,
        );
      }

      await new Promise(r => setTimeout(r, pollMs));
    }
  }

  try {
    return await fn();
  } finally {
    const current = await readHolder(lockPath);
    if (current?.pid === holder.pid) await unlinkIfExists(lockPath);
  }
}
