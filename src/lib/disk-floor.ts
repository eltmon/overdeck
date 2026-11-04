import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, statfs, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from './paths.js';
import { withFileLock } from './vault/file-lock.js';

const GIB = 1024 ** 3;

export const DISK_SAFETY_FLOOR_BYTES = 10 * GIB;

/** Every disk-floor refusal starts with this text (PAN-4961). */
export const DISK_LOW_HELD_PREFIX = 'Disk low — new workspace starts are held';
/** A live holder renews its reservation file's mtime this often. */
export const DISK_RESERVATION_HEARTBEAT_MS = 60_000;
/** A reservation whose mtime is older than this no longer counts (crashed holder, reused pid). */
export const DISK_RESERVATION_STALE_MS = 10 * 60_000;

export async function readAvailableBytes(path: string): Promise<number> {
  const stats = await statfs(path);
  return stats.bavail * stats.bsize;
}

/**
 * Refuse an operation before it can run the filesystem out of space:
 * ENOSPC mid-write zero-fills files rather than failing cleanly (PAN-1674
 * truncated ~/.claude.json this way), so this checks ahead of time instead
 * of only warning.
 */
export async function checkDiskFloor(path: string, read: (path: string) => Promise<number> = readAvailableBytes): Promise<string | null> {
  let availableBytes: number;
  try {
    availableBytes = await read(path);
  } catch {
    return null;
  }

  if (availableBytes >= DISK_SAFETY_FLOOR_BYTES) {
    return null;
  }

  const availableGib = (availableBytes / GIB).toFixed(1);
  return `${DISK_LOW_HELD_PREFIX}: only ${availableGib} GiB free on the filesystem holding ${path}; the safety floor is 10.0 GiB. Free disk space (see /resources) and retry.`;
}

export interface DiskReservation { release: () => Promise<void> }

export interface DiskFloorLedgerDeps {
  read?: (path: string) => Promise<number>;
  ledgerDir?: string;
  withLock?: <T>(lockPath: string, fn: () => Promise<T>) => Promise<T>;
  isPidAlive?: (pid: number) => boolean;
  now?: () => number;
  setInterval?: typeof setInterval;
}

interface LedgerEntry { file: string; pid: number; bytes: number; mtimeMs: number }

interface LedgerSum { reservedBytes: number; inFlightCount: number }

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function resolveLedgerDir(deps: DiskFloorLedgerDeps): string {
  return deps.ledgerDir ?? join(getOverdeckHome(), 'disk-reservations');
}

function ledgerUnavailableText(ledgerDir: string, error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return `${DISK_LOW_HELD_PREFIX}: the disk reservation ledger at ${ledgerDir} is unavailable (${msg}), so in-flight workspace setups cannot be counted. Fix the directory and retry.`;
}

function formatDiskFloorRefusal(path: string, availableBytes: number, sum: LedgerSum, ownBytes: number): string {
  const gib = (bytes: number) => (bytes / GIB).toFixed(1);
  return `${DISK_LOW_HELD_PREFIX}: ${gib(availableBytes)} GiB free on the filesystem holding ${path}, ${gib(sum.reservedBytes)} GiB reserved by ${sum.inFlightCount} in-flight workspace setup(s), this step needs ${gib(ownBytes)} GiB, and the safety floor is 10.0 GiB. Free disk space (see /resources) and retry.`;
}

/**
 * Read the ledger and sum the live reservations. A reservation is live when
 * its pid runs and its mtime is fresh. With `prune`, dead, stale and
 * unparsable entries are deleted; without it they are only skipped. A single
 * entry that vanishes mid-listing (a concurrent release) is skipped.
 */
async function sumLiveReservations(
  ledgerDir: string,
  options: { prune: boolean; isPidAlive: (pid: number) => boolean; now: () => number },
): Promise<LedgerSum> {
  const names = (await readdir(ledgerDir)).filter((name) => name.endsWith('.json'));
  const entries: LedgerEntry[] = [];
  for (const name of names) {
    const file = join(ledgerDir, name);
    let raw: string;
    let mtimeMs: number;
    try {
      raw = await readFile(file, 'utf8');
      mtimeMs = (await stat(file)).mtimeMs;
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    let parsed: { pid?: unknown; bytes?: unknown };
    try {
      parsed = JSON.parse(raw) as { pid?: unknown; bytes?: unknown };
    } catch {
      if (options.prune) await rm(file, { force: true });
      continue;
    }
    const pid = Number.isInteger(parsed.pid) ? (parsed.pid as number) : 0;
    const bytes = typeof parsed.bytes === 'number' && Number.isFinite(parsed.bytes) ? parsed.bytes : 0;
    entries.push({ file, pid, bytes, mtimeMs });
  }

  let reservedBytes = 0;
  let inFlightCount = 0;
  for (const entry of entries) {
    const live = entry.pid > 0
      && options.isPidAlive(entry.pid)
      && options.now() - entry.mtimeMs <= DISK_RESERVATION_STALE_MS;
    if (!live) {
      if (options.prune) await rm(entry.file, { force: true });
      continue;
    }
    reservedBytes += entry.bytes;
    inFlightCount += 1;
  }
  return { reservedBytes, inFlightCount };
}

const NO_OP_RESERVATION: DiskReservation = { release: async () => {} };

/**
 * Admit a disk-heavy phase or refuse it (PAN-4961). Admission is serialized
 * by a cross-process lock, so every admitted reservation counts against every
 * later one. statfs failure admits (nothing to compare); ledger failure
 * refuses, because ignoring the ledger lets concurrent starts all pass.
 */
export async function reserveDiskFloor(
  input: { path: string; bytes: number; label: string },
  deps: DiskFloorLedgerDeps = {},
): Promise<{ ok: true; reservation: DiskReservation } | { ok: false; error: string }> {
  const ledgerDir = resolveLedgerDir(deps);
  const read = deps.read ?? readAvailableBytes;
  const withLock = deps.withLock ?? withFileLock;
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  const now = deps.now ?? Date.now;
  const startInterval = deps.setInterval ?? setInterval;

  type Admission = { ok: true; file: string | null } | { ok: false; error: string };
  let admission: Admission;
  try {
    await mkdir(ledgerDir, { recursive: true });
    admission = await withLock(join(ledgerDir, '.lock'), async (): Promise<Admission> => {
      const sum = await sumLiveReservations(ledgerDir, { prune: true, isPidAlive, now });
      let availableBytes: number;
      try {
        availableBytes = await read(input.path);
      } catch {
        return { ok: true, file: null };
      }
      if (availableBytes - sum.reservedBytes - input.bytes < DISK_SAFETY_FLOOR_BYTES) {
        return { ok: false, error: formatDiskFloorRefusal(input.path, availableBytes, sum, input.bytes) };
      }
      const file = join(ledgerDir, `${randomUUID()}.json`);
      const createdAt = now();
      await writeFile(file, JSON.stringify({ pid: process.pid, bytes: input.bytes, label: input.label, path: input.path, createdAt }));
      await utimes(file, new Date(createdAt), new Date(createdAt));
      return { ok: true, file };
    });
  } catch (error) {
    const text = ledgerUnavailableText(ledgerDir, error);
    console.warn(text);
    return { ok: false, error: text };
  }

  if (!admission.ok) return admission;
  const file = admission.file;
  if (file === null) return { ok: true, reservation: NO_OP_RESERVATION };

  let renewing = false;
  const heartbeat = startInterval(() => {
    if (renewing) return;
    renewing = true;
    const at = new Date(now());
    utimes(file, at, at).catch(() => {}).finally(() => { renewing = false; });
  }, DISK_RESERVATION_HEARTBEAT_MS);
  heartbeat.unref?.();

  let released = false;
  return {
    ok: true,
    reservation: {
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        await rm(file, { force: true });
      },
    },
  };
}

/** Same arithmetic as reserveDiskFloor, writes nothing. Returns the refusal text or null. */
export async function previewDiskFloor(
  input: { path: string; bytes: number },
  deps: DiskFloorLedgerDeps = {},
): Promise<string | null> {
  const ledgerDir = resolveLedgerDir(deps);
  const read = deps.read ?? readAvailableBytes;
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  const now = deps.now ?? Date.now;

  let sum: LedgerSum;
  try {
    sum = await sumLiveReservations(ledgerDir, { prune: false, isPidAlive, now });
  } catch (error) {
    if (isMissing(error)) {
      sum = { reservedBytes: 0, inFlightCount: 0 };
    } else {
      return ledgerUnavailableText(ledgerDir, error);
    }
  }

  let availableBytes: number;
  try {
    availableBytes = await read(input.path);
  } catch {
    return null;
  }
  if (availableBytes - sum.reservedBytes - input.bytes < DISK_SAFETY_FLOOR_BYTES) {
    return formatDiskFloorRefusal(input.path, availableBytes, sum, input.bytes);
  }
  return null;
}
