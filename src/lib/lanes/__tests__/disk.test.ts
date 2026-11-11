/**
 * PAN-5094 WI-1: lane disk admission. Temp OVERDECK_HOME, explicit ledgerDir,
 * fake read and fake estimate — never the host's real free space (NFR-2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DISK_LOW_HELD_PREFIX } from '../../disk-floor.js';
import type { LaneConfig } from '../config.js';
import {
  admitLaneDisk,
  checkLaneDisk,
  holdLaneDisk,
  LANE_DISK_HOLD_MS,
  LANE_DISK_LOW_CODE,
  LANE_WORKTREE_MIN_BYTES,
  laneLaunchBytes,
  laneWorktreeBytes,
  type LaneDiskCheckDeps,
  type LaneDiskDeps,
} from '../disk.js';
import { LaneLaunchError } from '../types.js';

const GIB = 1024 ** 3;

let ledgerDir: string;

beforeEach(() => {
  ledgerDir = mkdtempSync(join(tmpdir(), 'lane-disk-ledger-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(ledgerDir, { recursive: true, force: true });
});

function config(overrides: Partial<LaneConfig> = {}): LaneConfig {
  return {
    projectKey: 'lexerra',
    projectPath: '/projects/lexerra',
    lanesRoot: '/projects/lexerra-lanes',
    baseRef: 'origin/main',
    sparseCheckout: null,
    roles: {},
    ...overrides,
  };
}

function ledgerFiles(): string[] {
  return readdirSync(ledgerDir).filter((name) => name.endsWith('.json'));
}

describe('admitLaneDisk', () => {
  it('rejects with LaneLaunchError(507, …, disk-low) below the floor (ac1)', async () => {
    const deps: LaneDiskDeps = { ledgerDir, read: async () => 5 * GIB, estimate: async () => 0 };

    const result = admitLaneDisk(
      { config: config(), lanesRoot: '/projects/lexerra-lanes', role: 'builder', reuse: false, label: 'lane:run/key/builder' },
      deps,
    );

    await expect(result).rejects.toThrow(LaneLaunchError);
    try {
      await result;
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LaneLaunchError);
      const laneError = error as LaneLaunchError;
      expect(laneError.status).toBe(507);
      expect(laneError.code).toBe(LANE_DISK_LOW_CODE);
      expect(laneError.message.startsWith(DISK_LOW_HELD_PREFIX)).toBe(true);
      expect(laneError.message).toContain('5.0 GiB free');
    }
  });

  it('resolves and leaves one lease that release() removes (ac2)', async () => {
    const deps: LaneDiskDeps = { ledgerDir, read: async () => 100 * GIB, estimate: async () => 2 * GIB };

    const reservation = await admitLaneDisk(
      { config: config(), lanesRoot: '/projects/lexerra-lanes', role: 'builder', reuse: false, label: 'lane:run/key/builder' },
      deps,
    );

    const files = ledgerFiles();
    expect(files).toHaveLength(1);
    const entry = JSON.parse(readFileSync(join(ledgerDir, files[0]!), 'utf8')) as { bytes: number; label: string };
    expect(entry.bytes).toBe(2 * GIB);
    expect(entry.label).toBe('lane:run/key/builder');

    await reservation.release();
    expect(ledgerFiles()).toHaveLength(0);
  });

  it('refuses a builder but admits the same launch with reuse: true, never calling estimate for reuse or play (ac3)', async () => {
    const estimate = vi.fn(async () => 1 * GIB);
    const deps: LaneDiskDeps = { ledgerDir, read: async () => 10.5 * GIB, estimate };

    await expect(
      admitLaneDisk(
        { config: config(), lanesRoot: '/projects/lexerra-lanes', role: 'builder', reuse: false, label: 'lane:run/key/builder' },
        deps,
      ),
    ).rejects.toThrow(LaneLaunchError);
    expect(estimate).toHaveBeenCalledTimes(1);

    const reused = await admitLaneDisk(
      { config: config(), lanesRoot: '/projects/lexerra-lanes', role: 'builder', reuse: true, label: 'lane:run/key/builder' },
      deps,
    );
    expect(estimate).toHaveBeenCalledTimes(1);
    await reused.release();

    const played = await admitLaneDisk(
      { config: config(), lanesRoot: '/projects/lexerra-lanes', role: 'play', reuse: false, label: 'lane:run/key/play' },
      deps,
    );
    expect(estimate).toHaveBeenCalledTimes(1);
    await played.release();
  });
});

describe('laneLaunchBytes', () => {
  it('returns 0 for reuse and for role play without calling estimate', async () => {
    const estimate = vi.fn(async () => 3 * GIB);

    expect(await laneLaunchBytes({ config: config(), role: 'builder', reuse: true }, { estimate })).toBe(0);
    expect(await laneLaunchBytes({ config: config(), role: 'play', reuse: false }, { estimate })).toBe(0);
    expect(estimate).not.toHaveBeenCalled();
  });
});

describe('laneWorktreeBytes', () => {
  it('floors a small estimate at LANE_WORKTREE_MIN_BYTES and passes through a larger one', async () => {
    const small = vi.fn(async () => ({ hostBytes: 0.3 * GIB, stackBytes: 0, hostSource: 'measured' as const, stackSource: 'none' as const }));
    const large = vi.fn(async () => ({ hostBytes: 3 * GIB, stackBytes: 0, hostSource: 'measured' as const, stackSource: 'none' as const }));

    expect(await laneWorktreeBytes(config(), small)).toBe(LANE_WORKTREE_MIN_BYTES);
    expect(await laneWorktreeBytes(config(), large)).toBe(3 * GIB);
  });
});

describe('holdLaneDisk', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('counts both held leases against a third admission until the hold expires', async () => {
    const deps: LaneDiskDeps = { ledgerDir, read: async () => 30 * GIB, estimate: async () => 8 * GIB };
    const releases: Promise<void>[] = [];
    function holdAndTrack(reservation: Awaited<ReturnType<typeof admitLaneDisk>>): void {
      const release = reservation.release;
      reservation.release = () => {
        const promise = release();
        releases.push(promise);
        return promise;
      };
      holdLaneDisk(reservation);
    }

    const a = await admitLaneDisk(
      { config: config(), lanesRoot: '/projects/lexerra-lanes', role: 'builder', reuse: false, label: 'lane:run/a/builder' },
      deps,
    );
    holdAndTrack(a);

    const b = await admitLaneDisk(
      { config: config(), lanesRoot: '/projects/lexerra-lanes', role: 'builder', reuse: false, label: 'lane:run/b/builder' },
      deps,
    );
    holdAndTrack(b);

    expect(ledgerFiles()).toHaveLength(2);

    await expect(
      admitLaneDisk(
        { config: config(), lanesRoot: '/projects/lexerra-lanes', role: 'builder', reuse: false, label: 'lane:run/c/builder' },
        deps,
      ),
    ).rejects.toThrow(LaneLaunchError);

    await vi.advanceTimersByTimeAsync(LANE_DISK_HOLD_MS);
    await Promise.all(releases);

    expect(ledgerFiles()).toHaveLength(0);

    const c = await admitLaneDisk(
      { config: config(), lanesRoot: '/projects/lexerra-lanes', role: 'builder', reuse: false, label: 'lane:run/c/builder' },
      deps,
    );
    await c.release();
    expect(existsSync(ledgerDir)).toBe(true);
  });
});

describe('checkLaneDisk', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lane-disk-check-'));
    mkdirSync(join(root, 'a'));
    mkdirSync(join(root, 'b'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists directories not held by a lane row, with room and the estimate as bytes (ac1)', async () => {
    const deps: LaneDiskCheckDeps = {
      ledgerDir,
      resolveConfig: vi.fn(async () => config({ lanesRoot: root })),
      laneCwds: vi.fn(async () => [join(root, 'a')]),
      read: async () => 100 * GIB,
      estimate: async () => 1 * GIB,
    };

    const result = await checkLaneDisk({ project: 'lexerra' }, deps);

    expect(result).toMatchObject({ path: root, bytes: 1 * GIB, refusal: null, unregistered: [join(root, 'b')] });
  });

  it('refuses below the floor with the same bytes (ac1)', async () => {
    const deps: LaneDiskCheckDeps = {
      ledgerDir,
      resolveConfig: vi.fn(async () => config({ lanesRoot: root })),
      laneCwds: vi.fn(async () => [join(root, 'a')]),
      read: async () => 5 * GIB,
      estimate: async () => 1 * GIB,
    };

    const result = await checkLaneDisk({ project: 'lexerra' }, deps);

    expect(result.refusal?.startsWith(DISK_LOW_HELD_PREFIX)).toBe(true);
  });

  it('previews a cold cross-mount lanes root at its nearest existing ancestor, never the project path (FR-9)', async () => {
    const mountDir = join(root, 'mount');
    mkdirSync(mountDir);
    const lanesRoot = join(mountDir, 'lanes');
    const projectPath = join(root, 'project');
    const deps: LaneDiskCheckDeps = {
      ledgerDir,
      resolveConfig: vi.fn(async () => config({ lanesRoot, projectPath })),
      read: async (path: string) => (path === mountDir ? 5 * GIB : 100 * GIB),
      estimate: async () => 1 * GIB,
    };

    const result = await checkLaneDisk({ project: 'lexerra' }, deps);

    expect(result.path).toBe(mountDir);
    expect(result.refusal?.startsWith(DISK_LOW_HELD_PREFIX)).toBe(true);
    expect(result.unregistered).toEqual([]);
  });

  it('walks a missing --path target up to its nearest existing ancestor (FR-9)', async () => {
    const missing = join(root, 'missing', 'deeper');

    const result = await checkLaneDisk({ path: missing }, { ledgerDir, read: async () => 100 * GIB });

    expect(result.path).toBe(root);
  });

  it('returns a null availableBytes and a null refusal when read throws, without a project (ac2)', async () => {
    const result = await checkLaneDisk({ path: root }, { ledgerDir, read: async () => { throw new Error('statfs failed'); } });

    expect(result).toMatchObject({ path: root, bytes: 0, availableBytes: null, refusal: null, unregistered: [] });
  });
});
