/**
 * SystemCapabilities probe for adaptive scan parallelism (PAN-457).
 *
 * Detects CPU cores, drive type (SSD vs HDD), drive read speed, and
 * available memory. Chooses optimal scan parallelism from these stats.
 *
 * Zero sync FS or execSync calls — uses execAsync + fs/promises only.
 * Result is cached per-process (probe runs at most once).
 */

import { cpus, freemem } from 'os';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
export async function getSystemCapabilities(
  scanMaxParallel?: number | null,
): Promise<SystemCapabilities> {
  if (cachedCapabilities === null) {
    cachedCapabilities = await probe();
  }
  if (scanMaxParallel != null && scanMaxParallel > 0) {
    return { ...cachedCapabilities, recommendedParallelism: scanMaxParallel };
  }
  return cachedCapabilities;
}

/** Reset the cache (for tests). */
export function resetSystemCapabilitiesCache(): void {
  cachedCapabilities = null;
}

// ─── Probe implementation ─────────────────────────────────────────────────────

async function probe(): Promise<SystemCapabilities> {
  const cpuCores = cpus().length;
  const availableMemoryMB = Math.round(freemem() / 1024 / 1024);

  const driveType = await detectDriveType();
  const driveReadMBps = await measureDriveReadSpeed();

  const partial = { cpuCores, driveType, driveReadMBps, availableMemoryMB };
  return { ...partial, recommendedParallelism: computeParallelism(partial) };
}

/**
 * Detect drive type using lsblk on Linux.
 * Falls back to 'unknown' on macOS/Windows or if lsblk is unavailable.
 */
async function detectDriveType(): Promise<DriveType> {
  if (process.platform !== 'linux') return 'unknown';

  try {
    const { stdout } = await execAsync('lsblk -d -o name,rota --noheadings 2>/dev/null');
    // rota=0 means non-rotational (SSD/NVMe), rota=1 means HDD
    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return 'unknown';

    const rotaCounts = { ssd: 0, hdd: 0 };
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const rota = parts[1];
      if (rota === '0') rotaCounts.ssd++;
      else if (rota === '1') rotaCounts.hdd++;
    }

    if (rotaCounts.ssd > 0 && rotaCounts.hdd === 0) return 'ssd';
    if (rotaCounts.hdd > 0 && rotaCounts.ssd === 0) return 'hdd';
    // Mixed: default to ssd (common in modern systems)
    if (rotaCounts.ssd >= rotaCounts.hdd) return 'ssd';
    return 'hdd';
  } catch {
    return 'unknown';
  }
}

/** Measure sequential read speed by reading a 10MB temp file. */
async function measureDriveReadSpeed(): Promise<number> {
  const SAMPLE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
  const tmpFile = join(tmpdir(), `pan-probe-${process.pid}.bin`);

  try {
    // Write a 10MB buffer
    const buf = Buffer.alloc(SAMPLE_SIZE_BYTES, 0x42);
    await fs.writeFile(tmpFile, buf);

    // Read it back and measure elapsed time
    const start = performance.now();
    await fs.readFile(tmpFile);
    const elapsedMs = performance.now() - start;

    // MB/s = bytes / (elapsed / 1000) / 1024 / 1024
    const mbps = (SAMPLE_SIZE_BYTES / (elapsedMs / 1000)) / 1024 / 1024;
    return Math.round(mbps);
  } catch {
    return 0;
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}
