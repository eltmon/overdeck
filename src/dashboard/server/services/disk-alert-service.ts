/**
 * PAN-5093: disk alert service. Polls free bytes on the Overdeck home's
 * filesystem every 30s (D-1), pushes a Needs-you item + phone push on each
 * severity crossing (FR-1..FR-3), and measures space holders once per
 * crossing, at most one scan in flight service-wide (D-7). Runs in the
 * primary dashboard only (main.ts); a peer would push every crossing twice.
 */

import { statfs } from 'node:fs/promises';
import type { DiskAlertHolders, DiskAlertLevel, DiskAlertSnapshot } from '@overdeck/contracts';
import { emitActivityEntry, type EmitActivityOptions } from '../../../lib/activity-logger.js';
import { loadGlobalConfigNoMigration } from '../../../lib/config-yaml/load.js';
import { collectDiskHolders } from '../../../lib/disk-alert-holders.js';
import {
  DISK_ALERT_POLL_MS,
  diskAlertPush,
  diskAlertThresholds,
  isDiskAlertCrossing,
  nextDiskAlertLevel,
  type DiskAlertThresholds,
} from '../../../lib/disk-alert.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import type { EdgeNotification } from '../../../lib/push/classify.js';
import { pushNeedsYouEdge } from './needs-you-push-service.js';

const GIB = 1024 ** 3;

function formatGib(bytes: number): string {
  return (bytes / GIB).toFixed(1);
}

export interface DiskAlertServiceDeps {
  path: string;
  readSpace: (path: string) => Promise<{ availableBytes: number; totalBytes: number }>;
  readThresholds: () => Promise<DiskAlertThresholds>;
  collectHolders: () => Promise<DiskAlertHolders>;
  push: (n: EdgeNotification) => void;
  emit: (entry: EmitActivityOptions) => void;
  now: () => number;
}

async function defaultReadSpace(path: string): Promise<{ availableBytes: number; totalBytes: number }> {
  const stats = await statfs(path);
  return { availableBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
}

async function defaultReadThresholds(): Promise<DiskAlertThresholds> {
  const { config } = await loadGlobalConfigNoMigration();
  return diskAlertThresholds(config.resources);
}

async function defaultCollectHolders(): Promise<DiskAlertHolders> {
  const { config } = await loadGlobalConfigNoMigration();
  return collectDiskHolders({ conversationIndexPath: config.conversationSearch.dbPath });
}

function resolveDeps(deps: Partial<DiskAlertServiceDeps>): DiskAlertServiceDeps {
  return {
    path: deps.path ?? getOverdeckHome(),
    readSpace: deps.readSpace ?? defaultReadSpace,
    readThresholds: deps.readThresholds ?? defaultReadThresholds,
    collectHolders: deps.collectHolders ?? defaultCollectHolders,
    push: deps.push ?? pushNeedsYouEdge,
    emit: deps.emit ?? emitActivityEntry,
    now: deps.now ?? Date.now,
  };
}

interface ServiceState {
  deps: DiskAlertServiceDeps;
  pollInFlight: boolean;
  level: DiskAlertLevel;
  thresholds: DiskAlertThresholds;
  availableBytes: number | null;
  totalBytes: number | null;
  since: string | null;
  checkedAt: string | null;
  measuring: boolean;
  holders: DiskAlertHolders | null;
  /** Bumped on every recovery to `ok`, so a scan that started before it can tell it is stale. */
  alertGeneration: number;
  scanInFlight: boolean;
}

let state: ServiceState | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** One holder scan at a time, service-wide. Restarted if it settles stale and the level is not `ok`. */
function ensureHolderScan(s: ServiceState): void {
  if (s.scanInFlight) return;
  const scanGeneration = s.alertGeneration;
  s.scanInFlight = true;
  s.measuring = true;
  s.deps.collectHolders().then(
    (holders): { ok: true; holders: DiskAlertHolders } => ({ ok: true, holders }),
    (): { ok: false } => ({ ok: false }),
  ).then((result) => {
    s.scanInFlight = false;
    s.measuring = false;
    const current = scanGeneration === s.alertGeneration;
    if (current) {
      if (s.level === 'ok') return;
      s.holders = result.ok
        ? result.holders
        : { measuredAt: new Date(s.deps.now()).toISOString(), incomplete: true, holders: [] };
    } else if (s.level !== 'ok') {
      ensureHolderScan(s);
    }
  });
}

async function pollOnce(s: ServiceState): Promise<void> {
  if (s.pollInFlight) return;
  s.pollInFlight = true;
  try {
    try {
      s.thresholds = await s.deps.readThresholds();
    } catch {
      // Keep the last good thresholds.
    }

    let space: { availableBytes: number; totalBytes: number };
    try {
      space = await s.deps.readSpace(s.deps.path);
    } catch {
      return; // Skip this poll; level unchanged, nothing pushed (NFR-4).
    }
    s.availableBytes = space.availableBytes;
    s.totalBytes = space.totalBytes;
    s.checkedAt = new Date(s.deps.now()).toISOString();

    const previous = s.level;
    const next = nextDiskAlertLevel(previous, space.availableBytes, s.thresholds);
    if (next === previous) return;

    if (isDiskAlertCrossing(previous, next)) {
      const since = new Date(s.deps.now()).toISOString();
      s.level = next;
      s.since = since;
      const notification = diskAlertPush(next as 'warning' | 'critical', space.availableBytes, s.thresholds, s.deps.path, since);
      s.deps.push(notification);
      s.deps.emit({
        source: 'dashboard',
        level: next === 'critical' ? 'error' : 'warn',
        link: '/resources',
        message: notification.body,
        desktop: next === 'critical',
      });
      ensureHolderScan(s);
    } else if (next === 'ok') {
      s.level = 'ok';
      s.since = null;
      s.holders = null;
      s.alertGeneration += 1;
      s.deps.emit({
        source: 'dashboard',
        level: 'info',
        link: '/resources',
        message: `Disk recovered: ${formatGib(space.availableBytes)} GiB free on the filesystem holding ${s.deps.path}.`,
      });
    } else {
      // critical -> warning: a step down, not a recovery. No push, no entry (D-11).
      s.level = next;
    }
  } finally {
    s.pollInFlight = false;
  }
}

function tick(): void {
  const s = state;
  if (!s) return;
  pollOnce(s).catch((error: unknown) => {
    console.warn('[disk-alert] poll failed:', error instanceof Error ? error.message : String(error));
  });
}

/** Idempotent. Runs one poll immediately, then every `DISK_ALERT_POLL_MS`. */
export function startDiskAlertService(deps: Partial<DiskAlertServiceDeps> = {}): void {
  if (state !== null) return;
  state = {
    deps: resolveDeps(deps),
    pollInFlight: false,
    level: 'ok',
    thresholds: diskAlertThresholds({ diskWarnGb: 5, diskCriticalGb: 2 }),
    availableBytes: null,
    totalBytes: null,
    since: null,
    checkedAt: null,
    measuring: false,
    holders: null,
    alertGeneration: 0,
    scanInFlight: false,
  };
  tick();
  timer = setInterval(tick, DISK_ALERT_POLL_MS);
  timer.unref?.();
}

export function stopDiskAlertService(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  state = null;
}

/** `level: 'ok'`, `checkedAt: null` when not started (D-13: a peer dashboard never starts the service). */
export function getDiskAlertSnapshot(): DiskAlertSnapshot {
  if (!state) {
    return {
      level: 'ok',
      path: getOverdeckHome(),
      availableBytes: null,
      totalBytes: null,
      warningBytes: 0,
      criticalBytes: 0,
      since: null,
      checkedAt: null,
      measuring: false,
      holders: null,
    };
  }
  return {
    level: state.level,
    path: state.deps.path,
    availableBytes: state.availableBytes,
    totalBytes: state.totalBytes,
    warningBytes: state.thresholds.warningBytes,
    criticalBytes: state.thresholds.criticalBytes,
    since: state.since,
    checkedAt: state.checkedAt,
    measuring: state.measuring,
    holders: state.holders,
  };
}

/** Exported for tests: force one poll outside the interval. */
export async function pollDiskAlertOnce(): Promise<void> {
  if (!state) return;
  await pollOnce(state);
}
