/**
 * The desktop lease and the cross-process lock that serializes helper calls
 * (PAN-5452, PRD 3d). Only one holder drives input at a time; read-only
 * commands don't need the lease (see run.ts's preamble).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { withFileLock } from '../vault/file-lock.js';
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
}

/** Runs `fn` under the one cross-process desktop lock (FR-5, D-6). Not reentrant. */
export async function withDesktopLock<T>(fn: () => Promise<T>, deps: WithDesktopLockDeps = {}): Promise<T> {
  const mkdirFn = deps.mkdir ?? mkdir;
  const resolveComputerUseDir = deps.computerUseDir ?? computerUseDir;
  const resolveLockPath = deps.lockPath ?? lockPath;
  await mkdirFn(resolveComputerUseDir(), { recursive: true, mode: 0o700 });
  return withFileLock(resolveLockPath(), fn, { staleMs: 60_000, label: 'pan computer' });
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

async function readLease(path: string, readFileFn: typeof readFile): Promise<LeaseRecord | null> {
  try {
    return JSON.parse(await readFileFn(path, 'utf-8')) as LeaseRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
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

  const existing = await readLease(path, readFileFn);
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
  const readFileFn = options.readFile ?? readFile;
  const rmFn = options.rm ?? rm;
  const holder = options.holder ?? holderId();

  const existing = await readLease(path, readFileFn);
  if (!existing) return;
  if (!options.force && existing.holder !== holder) {
    throw new ComputerUseError('desktop_busy', desktopBusyMessage(existing, Date.now()));
  }
  await rmFn(path, { force: true });
}
