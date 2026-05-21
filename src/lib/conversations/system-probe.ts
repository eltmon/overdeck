/**
 * SystemCapabilities probe for adaptive scan parallelism (PAN-457).
 *
 * Detects CPU cores, drive type (SSD vs HDD), drive read speed, and
 * available memory. Chooses optimal scan parallelism from these stats.
 *
 * PAN-1249: migrated to Effect — uses `ChildProcessSpawner` for `lsblk`
 * detection and `FileSystem` for the temp-file read-speed sample. Layers
 * are provided internally so the public Effect has no environment.
 *
 * Result is cached per-process (probe runs at most once).
 */

import { cpus, freemem, tmpdir } from 'os';
import { join } from 'path';
import { Duration, Effect, FileSystem } from 'effect';
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import { ChildProcess } from 'effect/unstable/process';
import { layer as NodeServicesLayer } from '@effect/platform-node/NodeServices';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DriveType = 'ssd' | 'hdd' | 'unknown';

export interface SystemCapabilities {
  cpuCores: number;
  driveType: DriveType;
  /** Measured sequential read speed in MB/s (0 if measurement failed) */
  driveReadMBps: number;
  /** Available memory in MB */
  availableMemoryMB: number;
  /** Recommended scan parallelism from the spec table */
  recommendedParallelism: number;
}

// ─── Parallelism table per spec ───────────────────────────────────────────────

function computeParallelism(caps: Omit<SystemCapabilities, 'recommendedParallelism'>): number {
  switch (caps.driveType) {
    case 'ssd':
      return Math.min(caps.cpuCores, 16);
    case 'hdd':
      return 2;
    default:
      return 4;
  }
}

// ─── Per-process cache ────────────────────────────────────────────────────────

let cachedCapabilities: SystemCapabilities | null = null;

/**
 * Probe system capabilities.
 * Result is cached after the first call — safe to call repeatedly.
 *
 * @param scanMaxParallel  Optional config override. When set, overrides the probe result.
 */
export function getSystemCapabilities(
  scanMaxParallel?: number | null,
): Effect.Effect<SystemCapabilities, never> {
  return Effect.gen(function* () {
    if (cachedCapabilities === null) {
      cachedCapabilities = yield* probe();
    }
    if (scanMaxParallel != null && scanMaxParallel > 0) {
      return { ...cachedCapabilities, recommendedParallelism: scanMaxParallel };
    }
    return cachedCapabilities;
  });
}

/** Reset the cache (for tests). */
export function resetSystemCapabilitiesCache(): void {
  cachedCapabilities = null;
}

// ─── Probe implementation ─────────────────────────────────────────────────────

const probeImpl: Effect.Effect<
  SystemCapabilities,
  never,
  FileSystem.FileSystem | ChildProcessSpawner
> = Effect.gen(function* () {
  const cpuCores = cpus().length;
  const availableMemoryMB = Math.round(freemem() / 1024 / 1024);

  const driveType = yield* detectDriveType;
  const driveReadMBps = yield* measureDriveReadSpeed;

  const partial = { cpuCores, driveType, driveReadMBps, availableMemoryMB };
  return { ...partial, recommendedParallelism: computeParallelism(partial) };
});

function probe(): Effect.Effect<SystemCapabilities, never> {
  return probeImpl.pipe(
    Effect.scoped,
    Effect.provide(NodeServicesLayer),
  );
}

/**
 * Detect drive type using lsblk on Linux.
 * Falls back to 'unknown' on macOS/Windows or if lsblk is unavailable.
 */
const detectDriveType: Effect.Effect<DriveType, never, ChildProcessSpawner> =
  Effect.gen(function* () {
    if (process.platform !== 'linux') return 'unknown' as DriveType;

    const spawner = yield* ChildProcessSpawner;
    const cmd = ChildProcess.make('lsblk', ['-d', '-o', 'name,rota', '--noheadings']);

    const stdout = yield* spawner.string(cmd).pipe(
      Effect.timeout(Duration.seconds(5)),
      Effect.orElseSucceed(() => null),
    );
    if (stdout == null) return 'unknown' as DriveType;

    // rota=0 means non-rotational (SSD/NVMe), rota=1 means HDD
    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return 'unknown' as DriveType;

    const rotaCounts = { ssd: 0, hdd: 0 };
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const rota = parts[1];
      if (rota === '0') rotaCounts.ssd++;
      else if (rota === '1') rotaCounts.hdd++;
    }

    if (rotaCounts.ssd > 0 && rotaCounts.hdd === 0) return 'ssd' as DriveType;
    if (rotaCounts.hdd > 0 && rotaCounts.ssd === 0) return 'hdd' as DriveType;
    // Mixed: default to ssd (common in modern systems)
    if (rotaCounts.ssd >= rotaCounts.hdd) return 'ssd' as DriveType;
    return 'hdd' as DriveType;
  });

/** Measure sequential read speed by reading a 10MB temp file. */
const measureDriveReadSpeed: Effect.Effect<number, never, FileSystem.FileSystem> =
  Effect.gen(function* () {
    const SAMPLE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
    const tmpFile = join(tmpdir(), `pan-probe-${process.pid}.bin`);
    const fs = yield* FileSystem.FileSystem;

    const measure = Effect.gen(function* () {
      // Write a 10MB buffer
      const buf = new Uint8Array(SAMPLE_SIZE_BYTES);
      buf.fill(0x42);
      yield* fs.writeFile(tmpFile, buf);

      // Read it back and measure elapsed time
      const start = performance.now();
      yield* fs.readFile(tmpFile);
      const elapsedMs = performance.now() - start;

      // MB/s = bytes / (elapsed / 1000) / 1024 / 1024
      const mbps = (SAMPLE_SIZE_BYTES / (elapsedMs / 1000)) / 1024 / 1024;
      return Math.round(mbps);
    });

    return yield* measure.pipe(
      Effect.ensuring(fs.remove(tmpFile).pipe(Effect.ignore)),
      Effect.orElseSucceed(() => 0),
    );
  });
