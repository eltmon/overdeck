/**
 * PAN-3809: Reclaim unused BuildKit cache before it can exhaust the host disk.
 * The Deacon calls this on its resource-pressure timer. Pruning is intentionally
 * limited to Docker's unused build cache; images, volumes, and workspaces stay
 * behind their existing explicit lifecycle gates.
 */

import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { promisify } from 'node:util';

import { emitActivityEntrySync, type EmitActivityOptions } from '../activity-logger.js';
import { getOverdeckHome } from '../paths.js';

const execFileAsync = promisify(execFile);
const GIB = 1024 ** 3;

export const DISK_PRUNE_TRIGGER_BYTES = 10 * GIB;
export const DISK_PRUNE_RETRY_MS = 5 * 60_000;

export interface DiskSpaceSnapshot {
  availableBytes: number;
  totalBytes: number;
}

export interface DiskPressurePatrolDeps {
  readDiskSpace: () => Promise<DiskSpaceSnapshot>;
  pruneBuildCache: () => Promise<string>;
  emit: (entry: EmitActivityOptions) => void;
  now: () => number;
}

let pruneInFlight = false;
let nextPruneAttemptAt = 0;

function formatGib(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

async function readDiskSpace(): Promise<DiskSpaceSnapshot> {
  const stats = await statfs(getOverdeckHome());
  return {
    availableBytes: stats.bavail * stats.bsize,
    totalBytes: stats.blocks * stats.bsize,
  };
}

async function pruneBuildCache(): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    'docker',
    ['builder', 'prune', '--all', '--force'],
    { encoding: 'utf-8', timeout: 10 * 60_000 },
  );
  return [stdout, stderr]
    .flatMap((value) => value.split('\n'))
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? '';
}

/** Run one disk-pressure check. Calls are safe to overlap; only one prune runs. */
export async function patrolDiskPressure(
  deps: Partial<DiskPressurePatrolDeps> = {},
): Promise<string[]> {
  const d: DiskPressurePatrolDeps = {
    readDiskSpace: deps.readDiskSpace ?? readDiskSpace,
    pruneBuildCache: deps.pruneBuildCache ?? pruneBuildCache,
    emit: deps.emit ?? emitActivityEntrySync,
    now: deps.now ?? Date.now,
  };
  const before = await d.readDiskSpace();
  if (before.availableBytes >= DISK_PRUNE_TRIGGER_BYTES) {
    nextPruneAttemptAt = 0;
    return [];
  }

  const now = d.now();
  if (pruneInFlight || now < nextPruneAttemptAt) return [];
  pruneInFlight = true;
  nextPruneAttemptAt = now + DISK_PRUNE_RETRY_MS;

  try {
    const output = await d.pruneBuildCache();
    const after = await d.readDiskSpace();
    const reclaimed = Math.max(0, after.availableBytes - before.availableBytes);
    const recovered = after.availableBytes >= DISK_PRUNE_TRIGGER_BYTES;
    const message = recovered
      ? `Disk pressure recovery pruned unused BuildKit cache and reclaimed ${formatGib(reclaimed)}; ${formatGib(after.availableBytes)} is now available.`
      : `Disk pressure recovery pruned unused BuildKit cache, but only ${formatGib(after.availableBytes)} is available; the ${formatGib(DISK_PRUNE_TRIGGER_BYTES)} safety floor is still unmet.`;
    d.emit({
      level: recovered ? 'info' : 'error',
      source: 'cloister',
      link: '/resources',
      message,
      details: [
        `Before: ${formatGib(before.availableBytes)} available of ${formatGib(before.totalBytes)}`,
        `After: ${formatGib(after.availableBytes)} available of ${formatGib(after.totalBytes)}`,
        output ? `Docker: ${output}` : 'Docker did not report reclaimed bytes.',
      ].join('\n'),
      desktop: !recovered,
    });
    return [`disk-pressure-patrol: pruned BuildKit cache (${formatGib(reclaimed)} reclaimed, ${formatGib(after.availableBytes)} available)`];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    d.emit({
      level: 'error',
      source: 'cloister',
      link: '/resources',
      message: `Disk pressure recovery could not prune unused BuildKit cache: ${reason}`,
      details: `${formatGib(before.availableBytes)} is available; the safety floor is ${formatGib(DISK_PRUNE_TRIGGER_BYTES)}. Deacon will retry in 5 minutes.`,
      desktop: true,
    });
    return [`disk-pressure-patrol: BuildKit prune failed (${reason})`];
  } finally {
    pruneInFlight = false;
  }
}

export function resetDiskPressurePatrolForTests(): void {
  pruneInFlight = false;
  nextPruneAttemptAt = 0;
}
