/**
 * SystemCapabilities probe for adaptive scan parallelism (PAN-457).
 *
 * Detects CPU cores, drive type (SSD vs HDD), drive read speed, and
 * available memory. Chooses optimal scan parallelism from these stats.
 *
 * Zero sync FS or execSync calls — uses Effect FileSystem + ChildProcessSpawner.
 * Result is cached per-process (probe runs at most once).
 */

import { cpus, freemem, tmpdir } from 'os';
import { join } from 'path';
import { Effect, FileSystem } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';

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
): Effect.Effect<SystemCapabilities, never, FileSystem.FileSystem | ChildProcessSpawner> {
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

function probe(): Effect.Effect<SystemCapabilities, never, FileSystem.FileSystem | ChildProcessSpawner> {
  return Effect.gen(function* () {
    const cpuCores = cpus().length;
    const availableMemoryMB = Math.round(freemem() / 1024 / 1024);

    const driveType = yield* detectDriveType();
    const driveReadMBps = yield* measureDriveReadSpeed();

    const partial = { cpuCores, driveType, driveReadMBps, availableMemoryMB };
    return { ...partial, recommendedParallelism: computeParallelism(partial) };
  });
}

/**
 * Detect drive type using lsblk on Linux.
 * Falls back to 'unknown' on macOS/Windows or if lsblk is unavailable.
 */
function detectDriveType(): Effect.Effect<DriveType, never, ChildProcessSpawner> {
  if (process.platform !== 'linux') return Effect.succeed('unknown' as DriveType);

  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;
    const lines = yield* spawner
      .lines(ChildProcess.make`lsblk -d -o name,rota --noheadings`)
      .pipe(Effect.catch(() => Effect.succeed([] as string[])));

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
  }).pipe(Effect.catch(() => Effect.succeed('unknown' as DriveType)));
}

/** Measure sequential read speed by reading a 10MB temp file. */
function measureDriveReadSpeed(): Effect.Effect<number, never, FileSystem.FileSystem> {
  const SAMPLE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
  const tmpFile = join(tmpdir(), `pan-probe-${process.pid}.bin`);

  const measure = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    // Write a 10MB buffer
    const buf = new Uint8Array(SAMPLE_SIZE_BYTES).fill(0x42);
    yield* fs.writeFile(tmpFile, buf);

    // Read it back and measure elapsed time
    const start = performance.now();
    yield* fs.readFile(tmpFile);
    const elapsedMs = performance.now() - start;

    // MB/s = bytes / (elapsed / 1000) / 1024 / 1024
    const mbps = (SAMPLE_SIZE_BYTES / (elapsedMs / 1000)) / 1024 / 1024;
    return Math.round(mbps);
  });

  const cleanup = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(tmpFile).pipe(Effect.catch(() => Effect.void));
  });

  return measure.pipe(
    Effect.ensuring(cleanup),
    Effect.catch(() => Effect.succeed(0)),
  );
}
