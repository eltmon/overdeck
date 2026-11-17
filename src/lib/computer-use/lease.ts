/**
 * The desktop lease and the cross-process lock that serializes helper calls
 * (PAN-5452, PRD 3d). Only one holder drives input at a time; read-only
 * commands don't need the lease (see run.ts's preamble).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { FileLockTimeoutError, withFileLock } from '../vault/file-lock.js';
import { ComputerUseError } from './errors.js';
import { computerUseDir, leasePath, lockPath } from './paths.js';

export const DESKTOP_LEASE_TTL_MS = 120_000;

interface LeaseRecord {
  holder: string;
  pid: number;
  acquiredAt: string;
  expiresAt: string;
}

/** The id this process claims the lease and the lock under. */
export function holderId(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OVERDECK_AGENT_ID) return env.OVERDECK_AGENT_ID;
  if (env.OVERDECK_CONVERSATION) return `conv:${env.OVERDECK_CONVERSATION}`;
  return 'operator';
}

/** `id`, sanitized for use as a directory name (see snapshotDir). */
export function holderKey(id: string = holderId()): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

export interface WithDesktopLockDeps {
  mkdir?: typeof mkdir;
  computerUseDir?: () => string;
  lockPath?: () => string;
  withFileLock?: typeof withFileLock;
}

/** Runs `fn` under the one cross-process desktop lock (FR-5, D-6). Not reentrant. */
export async function withDesktopLock<T>(fn: () => Promise<T>, deps: WithDesktopLockDeps = {}): Promise<T> {
  const mkdirFn = deps.mkdir ?? mkdir;
  const resolveComputerUseDir = deps.computerUseDir ?? computerUseDir;
  const resolveLockPath = deps.lockPath ?? lockPath;
  await mkdirFn(resolveComputerUseDir(), { recursive: true, mode: 0o700 });
  return withFileLock(resolveLockPath(), fn, { staleMs: 60_000, label: 'pan computer' });
}

/**
 * Like withDesktopLock, but gives up after `waitMs` and returns
 * `{ acquired: false }` instead of throwing (PAN-5461 D-7: the status route
 * never waits behind an agent). Errors thrown by `fn` propagate.
 */
export async function tryWithDesktopLock<T>(
  fn: () => Promise<T>,
  options: { waitMs: number },
  deps: WithDesktopLockDeps = {},
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const mkdirFn = deps.mkdir ?? mkdir;
  const resolveComputerUseDir = deps.computerUseDir ?? computerUseDir;
  const resolveLockPath = deps.lockPath ?? lockPath;
  const withFileLockFn = deps.withFileLock ?? withFileLock;
  await mkdirFn(resolveComputerUseDir(), { recursive: true, mode: 0o700 });
  try {
    const value = await withFileLockFn(resolveLockPath(), fn, {
      staleMs: 60_000,
      label: 'pan computer',
      timeoutMs: options.waitMs,
    });
    return { acquired: true, value };
  } catch (error) {
    if (error instanceof FileLockTimeoutError) return { acquired: false };
    throw error;
  }
}

export interface LeaseFsDeps {
  holder?: string;
  leasePath?: () => string;
  readFile?: typeof readFile;
  writeFile?: typeof writeFile;
  rm?: typeof rm;
}

function desktopBusyMessage(record: LeaseRecord, now: number): string {
  const seconds = Math.max(0, Math.ceil((new Date(record.expiresAt).getTime() - now) / 1000));
  return `The desktop is in use by ${record.holder} until ${record.expiresAt} (${seconds}s). Retry after that, or ask the operator to run pan computer release --force.`;
}

/**
 * A missing lease file and an unparseable one (a crash mid-write can leave it
 * empty or truncated) both mean "no valid lease" — an operator must still be
 * able to clear a stuck lease without hand-deleting a corrupt file first.
 */
async function readLeaseRecord(path: string, readFileFn: typeof readFile): Promise<LeaseRecord | null> {
  let raw: string;
  try {
    raw = await readFileFn(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    return JSON.parse(raw) as LeaseRecord;
  } catch {
    return null;
  }
}

export interface LeaseView {
  holder: string;
  expiresAt: string;
}

/** The current unexpired lease, or null. Never throws on a missing or corrupt file. */
export async function readLease(now: number, deps: LeaseFsDeps = {}): Promise<LeaseView | null> {
  const path = (deps.leasePath ?? leasePath)();
  const readFileFn = deps.readFile ?? readFile;
  let record: LeaseRecord | null;
  try {
    record = await readLeaseRecord(path, readFileFn);
  } catch {
    return null;
  }
  if (!record || typeof record.holder !== 'string' || typeof record.expiresAt !== 'string') return null;
  if (!(new Date(record.expiresAt).getTime() > now)) return null;
  return { holder: record.holder, expiresAt: record.expiresAt };
}

/**
 * Claims the desktop lease for `holder` at time `now` (called inside
 * `withDesktopLock` by input commands). Writes a fresh lease — expiring at
 * `now + DESKTOP_LEASE_TTL_MS` — when no lease exists, the existing one has
 * expired, or it is already held by the same holder. Otherwise throws
 * `desktop_busy`.
 */
export async function claimLease(now: number, deps: LeaseFsDeps = {}): Promise<void> {
  const path = (deps.leasePath ?? leasePath)();
  const readFileFn = deps.readFile ?? readFile;
  const writeFileFn = deps.writeFile ?? writeFile;
  const holder = deps.holder ?? holderId();

  const existing = await readLeaseRecord(path, readFileFn);
  if (existing && existing.holder !== holder && new Date(existing.expiresAt).getTime() > now) {
    throw new ComputerUseError('desktop_busy', desktopBusyMessage(existing, now));
  }

  const record: LeaseRecord = {
    holder,
    pid: process.pid,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DESKTOP_LEASE_TTL_MS).toISOString(),
  };
  await writeFileFn(path, JSON.stringify(record));
}

/** Deletes the lease file if the caller holds it, or always when `force` is set. */
export async function releaseLease(options: { force?: boolean } & LeaseFsDeps = {}): Promise<void> {
  const path = (options.leasePath ?? leasePath)();
  const rmFn = options.rm ?? rm;

  if (options.force) {
    await rmFn(path, { force: true });
    return;
  }

  const readFileFn = options.readFile ?? readFile;
  const holder = options.holder ?? holderId();
  const existing = await readLeaseRecord(path, readFileFn);
  if (!existing) return;
  if (existing.holder !== holder) {
    throw new ComputerUseError('desktop_busy', desktopBusyMessage(existing, Date.now()));
  }
  await rmFn(path, { force: true });
}
