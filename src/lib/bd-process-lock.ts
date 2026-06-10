import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Data, Effect } from 'effect';
import { getPanopticonHome } from './paths.js';

const TRANSIENT_BD_ERRNO_CODES = new Set(['EAGAIN', 'EBUSY', 'EWOULDBLOCK']);

const TRANSIENT_BD_LOCK_PATTERNS = [
  /\bdatabase is locked\b/i,
  /\block held\b/i,
  /\bfile is locked\b/i,
  /\bresource temporarily unavailable\b/i,
  /\bcould not acquire\b[^\n\r]*\block\b/i,
  /\bfailed to acquire\b[^\n\r]*\block\b/i,
  /\bunable to acquire\b[^\n\r]*\block\b/i,
  /\bcould not obtain\b[^\n\r]*\block\b/i,
  /\banother process\b[^\n\r]*\block/i,
];

const DEFAULT_STALE_LOCK_MS = 5 * 60 * 1000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_ACQUIRE_POLL_MS = 50;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_INITIAL_DELAY_MS = 100;
const DEFAULT_RETRY_MAX_DELAY_MS = 1_000;

type ErrorLikeRecord = Record<string, unknown>;
type SleepFn = (ms: number) => Promise<void>;

type ClockFn = () => number;

type RandomFn = () => number;

export type BdProcessLockHolder = {
  pid: number;
  ts: number;
  caller: string;
};

export type BdProcessLockHandle = {
  path: string;
  holder: BdProcessLockHolder;
  release(): Promise<void>;
};

export type BdProcessLockOptions = {
  workspacePath?: string;
  lockPath?: string;
  staleLockMs?: number;
  acquisitionTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: SleepFn;
  now?: ClockFn;
};

export type RunBdWithRetryOptions = BdProcessLockOptions & {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  random?: RandomFn;
  onRetry?: (context: { attempt: number; delayMs: number; error: unknown }) => void | Promise<void>;
};

export class BdProcessLockError extends Data.TaggedError('BdProcessLockError')<{
  readonly operation: string;
  readonly message: string;
  readonly path?: string;
  readonly caller?: string;
  readonly holder?: BdProcessLockHolder;
  readonly cause?: unknown;
}> {}

export class BdTransientFailure extends Data.TaggedError('BdTransientFailure')<{
  readonly operation: string;
  readonly message: string;
  readonly attempts: number;
  readonly caller: string;
  readonly cause?: unknown;
}> {}

function isRecord(value: unknown): value is ErrorLikeRecord {
  return typeof value === 'object' && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function pushString(parts: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    parts.push(value);
  }
}

function collectErrorText(error: unknown, parts: string[] = [], seen = new Set<unknown>()): string {
  if (error == null || seen.has(error)) return parts.join('\n');
  seen.add(error);

  if (typeof error === 'string') {
    pushString(parts, error);
    return parts.join('\n');
  }

  if (!isRecord(error)) return parts.join('\n');

  pushString(parts, error.stderr);
  pushString(parts, error.message);
  pushString(parts, error.stdout);

  collectErrorText(error.cause, parts, seen);
  return parts.join('\n');
}

function hasTransientErrnoCode(error: unknown, seen = new Set<unknown>()): boolean {
  if (error == null || seen.has(error)) return false;
  seen.add(error);

  if (!isRecord(error)) return false;

  if (typeof error.code === 'string' && TRANSIENT_BD_ERRNO_CODES.has(error.code)) {
    return true;
  }

  return hasTransientErrnoCode(error.cause, seen);
}

/**
 * Return true only for bd/Dolt lock-contention failures worth retrying.
 *
 * PAN-1629 reproduction note: the issue was triggered by concurrent `pan start`
 * processes whose `bd list --json -l pan-<id> --status all --limit 0` child
 * process failed while another process held the embedded Dolt DB lock. A local
 * throwaway repo stress run (`.pan/tmp/bd-lock-repro-*`, 2026-06-10) exercised
 * concurrent `bd list`/`bd create`; bd 1.0.4 serialized cleanly in that run, so
 * this predicate is intentionally limited to the exact embedded-Dolt text
 * documented by Beads for this condition (`database is locked`) plus equivalent
 * OS lock-acquisition phrases (`resource temporarily unavailable`, `could not
 * acquire ... lock`). Successful empty results are exit 0 + `[]`, not errors,
 * and must remain non-transient.
 */
export function isTransientBdError(error: unknown): boolean {
  if (error == null) return false;

  const text = collectErrorText(error);
  if (TRANSIENT_BD_LOCK_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return hasTransientErrnoCode(error);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function realpathIfExists(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return path;
    return path;
  }
}

export async function resolveSharedBeadsDir(workspacePath = process.cwd()): Promise<string> {
  const beadsDir = resolve(workspacePath, '.beads');
  const redirectPath = join(beadsDir, 'redirect');

  try {
    const target = (await readFile(redirectPath, 'utf8')).trim();
    if (target.length > 0) {
      const redirected = isAbsolute(target) ? target : resolve(beadsDir, target);
      return realpathIfExists(redirected);
    }
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
  }

  return realpathIfExists(beadsDir);
}

export async function bdProcessLockPath(workspacePath = process.cwd()): Promise<string> {
  const sharedBeadsDir = await resolveSharedBeadsDir(workspacePath);
  const digest = createHash('sha256').update(sharedBeadsDir).digest('hex').slice(0, 16);
  return join(getPanopticonHome(), 'locks', `bd-${digest}.lock`);
}

async function readHolderFromPath(path: string): Promise<BdProcessLockHolder | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<BdProcessLockHolder>;
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

export async function readBdProcessLockHolder(options: BdProcessLockOptions = {}): Promise<BdProcessLockHolder | null> {
  const path = options.lockPath ?? await bdProcessLockPath(options.workspacePath);
  return readHolderFromPath(path);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === 'EPERM';
  }
}

function isStale(holder: BdProcessLockHolder, now: number, staleLockMs: number): boolean {
  return now - holder.ts > staleLockMs || !isProcessAlive(holder.pid);
}

async function writeLockFile(path: string, holder: BdProcessLockHolder): Promise<void> {
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

function matchesHolder(actual: BdProcessLockHolder | null, expected: BdProcessLockHolder): boolean {
  return actual?.pid === expected.pid && actual.ts === expected.ts && actual.caller === expected.caller;
}

async function acquireStaleBreaker(
  path: string,
  caller: string,
  options: Required<Pick<BdProcessLockOptions, 'now' | 'staleLockMs'>>,
): Promise<BdProcessLockHandle | null> {
  const breakerPath = `${path}.break`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const holder = { pid: process.pid, ts: options.now(), caller: `${caller} stale bd lock breaker` };
    try {
      await writeLockFile(breakerPath, holder);
      let released = false;
      return {
        path: breakerPath,
        holder,
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
      if (existing && !isStale(existing, options.now(), options.staleLockMs)) return null;
      await unlinkIfExists(breakerPath);
    }
  }
  return null;
}

async function reclaimStaleLock(
  path: string,
  caller: string,
  options: Required<Pick<BdProcessLockOptions, 'now' | 'staleLockMs'>>,
): Promise<boolean> {
  const breaker = await acquireStaleBreaker(path, caller, options);
  if (!breaker) return false;

  try {
    const existing = await readHolderFromPath(path);
    if (existing && !isStale(existing, options.now(), options.staleLockMs)) return false;
    await unlinkIfExists(path);
    return true;
  } finally {
    await breaker.release();
  }
}

export async function acquireBdProcessLock(
  caller: string,
  options: BdProcessLockOptions = {},
): Promise<BdProcessLockHandle> {
  const path = options.lockPath ?? await bdProcessLockPath(options.workspacePath);
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const acquisitionTimeoutMs = options.acquisitionTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_ACQUIRE_POLL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + acquisitionTimeoutMs;

  await mkdir(dirname(path), { recursive: true });

  while (true) {
    const holder = { pid: process.pid, ts: now(), caller };
    try {
      await writeLockFile(path, holder);
      let released = false;
      return {
        path,
        holder,
        async release() {
          if (released) return;
          released = true;
          if (matchesHolder(await readHolderFromPath(path), holder)) {
            await unlinkIfExists(path);
          }
        },
      };
    } catch (error) {
      if (!isErrnoException(error) || error.code !== 'EEXIST') {
        throw new BdProcessLockError({
          operation: 'acquireBdProcessLock',
          message: error instanceof Error ? error.message : String(error),
          path,
          caller,
          cause: error,
        });
      }

      const existing = await readHolderFromPath(path);
      if (!existing || isStale(existing, now(), staleLockMs)) {
        await reclaimStaleLock(path, caller, { now, staleLockMs });
        continue;
      }

      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        throw new BdProcessLockError({
          operation: 'acquireBdProcessLock',
          message: `Timed out waiting for bd process lock held by pid ${existing.pid} (${existing.caller})`,
          path,
          caller,
          holder: existing,
        });
      }

      await sleep(Math.min(pollIntervalMs, remainingMs));
    }
  }
}

export async function withBdProcessLock<T>(
  caller: string,
  fn: () => Promise<T>,
  options: BdProcessLockOptions = {},
): Promise<T> {
  const handle = await acquireBdProcessLock(caller, options);
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}

function isRetryableBdFailure(error: unknown): boolean {
  return error instanceof BdProcessLockError || isTransientBdError(error);
}

function retryDelayMs(attempt: number, options: Required<Pick<RunBdWithRetryOptions, 'initialDelayMs' | 'maxDelayMs' | 'random'>>): number {
  const base = Math.min(options.maxDelayMs, options.initialDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(base * 0.2 * options.random());
  return Math.min(options.maxDelayMs, base + jitter);
}

export async function runBdWithRetry<T>(
  caller: string,
  fn: () => Promise<T>,
  options: RunBdWithRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_RETRY_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withBdProcessLock(caller, fn, options);
    } catch (error) {
      lastError = error;
      if (!isRetryableBdFailure(error) || attempt >= maxAttempts) break;
      const delayMs = retryDelayMs(attempt, { initialDelayMs, maxDelayMs, random });
      await options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }

  if (isRetryableBdFailure(lastError)) {
    throw new BdTransientFailure({
      operation: 'runBdWithRetry',
      message: `bd operation failed after ${maxAttempts} attempts due to transient lock contention`,
      attempts: maxAttempts,
      caller,
      cause: lastError,
    });
  }

  throw lastError;
}

export const readBdProcessLockHolderEffect = (
  options: BdProcessLockOptions = {},
): Effect.Effect<BdProcessLockHolder | null, BdProcessLockError> =>
  Effect.tryPromise({
    try: () => readBdProcessLockHolder(options),
    catch: (cause) =>
      new BdProcessLockError({
        operation: 'readBdProcessLockHolder',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

export const withBdProcessLockEffect = <A, E>(
  caller: string,
  fn: () => Effect.Effect<A, E>,
  options: BdProcessLockOptions = {},
): Effect.Effect<A, E | BdProcessLockError> =>
  Effect.tryPromise({
    try: () => withBdProcessLock(caller, () => Effect.runPromise(fn()), options),
    catch: (e) => e as E | BdProcessLockError,
  });

export const runBdWithRetryEffect = <A, E>(
  caller: string,
  fn: () => Effect.Effect<A, E>,
  options: RunBdWithRetryOptions = {},
): Effect.Effect<A, E | BdProcessLockError | BdTransientFailure> =>
  Effect.tryPromise({
    try: () => runBdWithRetry(caller, () => Effect.runPromise(fn()), options),
    catch: (e) => e as E | BdProcessLockError | BdTransientFailure,
  });
