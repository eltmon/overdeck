import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkDiskFloor,
  DISK_LOW_HELD_PREFIX,
  DISK_RESERVATION_STALE_MS,
  DISK_SAFETY_FLOOR_BYTES,
  previewDiskFloor,
  reserveDiskFloor,
  type DiskFloorLedgerDeps,
} from '../disk-floor.js';
import { DISK_PRUNE_TRIGGER_BYTES } from '../cloister/disk-pressure-patrol.js';

const GIB = 1024 ** 3;

describe('checkDiskFloor', () => {
  it('returns error text containing "10.0 GiB" when below the floor (AC1)', async () => {
    const error = await checkDiskFloor('/some/path', async () => 5 * GIB);

    expect(error).toContain('10.0 GiB');
    expect(error?.startsWith(DISK_LOW_HELD_PREFIX)).toBe(true);
  });

  it('returns null at or above the floor (AC2)', async () => {
    expect(await checkDiskFloor('/some/path', async () => DISK_SAFETY_FLOOR_BYTES)).toBeNull();
    expect(await checkDiskFloor('/some/path', async () => 20 * GIB)).toBeNull();
  });

  it('returns null when the reader throws (AC3)', async () => {
    const error = await checkDiskFloor('/some/path', async () => {
      throw new Error('statfs failed');
    });

    expect(error).toBeNull();
  });

  it('matches the disk-pressure-patrol trigger constant (AC4)', () => {
    expect(DISK_SAFETY_FLOOR_BYTES).toBe(DISK_PRUNE_TRIGGER_BYTES);
  });
});

/** In-process stand-in for withFileLock: a promise-chain mutex. */
function promiseChainLock(): NonNullable<DiskFloorLedgerDeps['withLock']> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(_lockPath: string, fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

function writeEntry(ledgerDir: string, name: string, entry: { pid: number; bytes: number }, mtimeMs: number): string {
  const file = join(ledgerDir, `${name}.json`);
  writeFileSync(file, JSON.stringify({ ...entry, label: 'fixture', path: '/p', createdAt: mtimeMs }));
  utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}

describe('reserveDiskFloor', () => {
  let ledgerDir: string;
  let deps: DiskFloorLedgerDeps;

  beforeEach(() => {
    ledgerDir = mkdtempSync(join(tmpdir(), 'disk-floor-ledger-'));
    deps = {
      ledgerDir,
      read: async () => 16 * GIB,
      withLock: promiseChainLock(),
      isPidAlive: () => true,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(ledgerDir, { recursive: true, force: true });
  });

  const reserve = (bytes = 2 * GIB) => reserveDiskFloor({ path: '/proj', bytes, label: 'PAN-1' }, deps);

  it('admits exactly 3 of 6 concurrent 2 GiB starts at 16 GiB free (floor-ledger.ac1)', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => reserve()));

    const admitted = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);
    expect(admitted).toHaveLength(3);
    expect(refused).toHaveLength(3);
    for (const result of refused) {
      if (result.ok) throw new Error('unreachable');
      expect(result.error.startsWith('Disk low — new workspace starts are held')).toBe(true);
      expect(result.error).toContain('10.0 GiB');
      expect(result.error).toContain('3 in-flight');
    }
    expect(readdirSync(ledgerDir).filter((name) => name.endsWith('.json'))).toHaveLength(3);
  });

  it('admits a 7th start after one reservation is released, and the file is gone (floor-ledger.ac2)', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => reserve()));
    const first = results.find((result) => result.ok);
    if (!first || !first.ok) throw new Error('expected an admitted reservation');

    const before = new Set(readdirSync(ledgerDir));
    await first.reservation.release();
    await first.reservation.release();
    const after = new Set(readdirSync(ledgerDir));
    const removed = [...before].filter((name) => !after.has(name));
    expect(removed).toHaveLength(1);

    const seventh = await reserve();
    expect(seventh.ok).toBe(true);
    expect(existsSync(join(ledgerDir, removed[0]))).toBe(false);
  });

  it('ignores and deletes a reservation whose pid is dead (floor-ledger.ac3)', async () => {
    deps.read = async () => 12 * GIB;
    deps.isPidAlive = (pid) => pid !== 999_999;
    const dead = writeEntry(ledgerDir, 'dead', { pid: 999_999, bytes: 2 * GIB }, Date.now());

    const result = await reserve();

    expect(result.ok).toBe(true);
    expect(existsSync(dead)).toBe(false);
  });

  it('ignores and deletes a live-pid reservation whose mtime is stale (floor-ledger.ac3)', async () => {
    deps.read = async () => 12 * GIB;
    const nowMs = Date.now();
    deps.now = () => nowMs;
    const stale = writeEntry(ledgerDir, 'stale', { pid: process.pid, bytes: 2 * GIB }, nowMs - DISK_RESERVATION_STALE_MS - 1_000);

    const result = await reserve();

    expect(result.ok).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  it('counts a live, fresh reservation (control for ac3)', async () => {
    deps.read = async () => 12 * GIB;
    writeEntry(ledgerDir, 'fresh', { pid: process.pid, bytes: 2 * GIB }, Date.now());

    const result = await reserve();

    expect(result.ok).toBe(false);
  });

  it('keeps counting a held reservation after 30 minutes because the heartbeat renews it (floor-ledger.ac4)', async () => {
    vi.useFakeTimers();
    deps.read = async () => 13 * GIB;

    const first = await reserve();
    expect(first.ok).toBe(true);
    const [name] = readdirSync(ledgerDir).filter((entry) => entry.endsWith('.json'));
    const file = join(ledgerDir, name);

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await vi.waitFor(async () => {
      expect(Date.now() - (await stat(file)).mtimeMs).toBeLessThan(DISK_RESERVATION_STALE_MS);
    });

    const second = await reserve();
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error).toContain('2.0 GiB reserved by 1 in-flight');
    expect(existsSync(file)).toBe(true);
  });

  it('refuses every concurrent start when the ledger lock fails (floor-ledger.ac5)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deps.withLock = async () => {
      throw new Error('lock exploded');
    };

    const results = await Promise.all(Array.from({ length: 6 }, () => reserve()));

    for (const result of results) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.startsWith(DISK_LOW_HELD_PREFIX)).toBe(true);
      expect(result.error).toContain(`the disk reservation ledger at ${ledgerDir} is unavailable`);
      expect(result.error).toContain('lock exploded');
    }
    expect(warn).toHaveBeenCalled();
  });

  it('admits with a no-op release when statfs throws (floor-ledger.ac5)', async () => {
    deps.read = async () => {
      throw new Error('statfs failed');
    };

    const result = await reserve();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(readdirSync(ledgerDir).filter((name) => name.endsWith('.json'))).toHaveLength(0);
    await result.reservation.release();
  });
});

describe('previewDiskFloor', () => {
  let ledgerDir: string;

  beforeEach(() => {
    ledgerDir = mkdtempSync(join(tmpdir(), 'disk-floor-preview-'));
  });

  afterEach(() => {
    rmSync(ledgerDir, { recursive: true, force: true });
  });

  it('returns the refusal text with two live 2 GiB reservations at 14 GiB free and writes nothing', async () => {
    writeEntry(ledgerDir, 'a', { pid: process.pid, bytes: 2 * GIB }, Date.now());
    writeEntry(ledgerDir, 'b', { pid: process.pid, bytes: 2 * GIB }, Date.now());
    const before = readdirSync(ledgerDir).sort();

    const error = await previewDiskFloor({ path: '/proj', bytes: 2 * GIB }, { ledgerDir, read: async () => 14 * GIB, isPidAlive: () => true });

    expect(error?.startsWith(DISK_LOW_HELD_PREFIX)).toBe(true);
    expect(error).toContain('4.0 GiB reserved by 2 in-flight');
    expect(error).toContain('10.0 GiB');
    expect(readdirSync(ledgerDir).sort()).toEqual(before);
  });

  it('returns null when the step fits and treats a missing ledger as empty', async () => {
    const error = await previewDiskFloor(
      { path: '/proj', bytes: 2 * GIB },
      { ledgerDir: join(ledgerDir, 'missing'), read: async () => 14 * GIB },
    );

    expect(error).toBeNull();
    expect(existsSync(join(ledgerDir, 'missing'))).toBe(false);
  });
});
