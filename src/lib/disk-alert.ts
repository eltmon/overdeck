/**
 * PAN-5093: the pure disk alert state machine. No I/O — the disk-alert
 * service (src/dashboard/server/services/disk-alert-service.ts) owns statfs,
 * config reads and the push dispatcher; this module only turns numbers into
 * levels and levels into a notification.
 */

import { homedir } from 'node:os';
import type { DiskAlertLevel } from '@overdeck/contracts';
import type { EdgeNotification } from './push/classify.js';

const GIB = 1024 ** 3;

/** How often the service polls `statfs` on the Overdeck home's filesystem. */
export const DISK_ALERT_POLL_MS = 30_000;

/**
 * Hysteresis: a level lowers only once free bytes clear that level's
 * threshold by this much, so free space hovering near a threshold does not
 * flap the alert (and push) on every poll.
 */
export const DISK_ALERT_RECOVERY_MARGIN_BYTES = 0.5 * GIB;

export interface DiskAlertThresholds {
  warningBytes: number;
  criticalBytes: number;
}

export function diskAlertThresholds(resources: { diskWarnGb: number; diskCriticalGb: number }): DiskAlertThresholds {
  return {
    warningBytes: resources.diskWarnGb * GIB,
    criticalBytes: resources.diskCriticalGb * GIB,
  };
}

const LEVEL_RANK: Record<DiskAlertLevel, number> = { ok: 0, warning: 1, critical: 2 };

/**
 * Raise at once; lower only past the recovery margin, so a level that just
 * crossed down stays until free space clears the threshold plus the margin.
 */
export function nextDiskAlertLevel(
  previous: DiskAlertLevel,
  availableBytes: number,
  thresholds: DiskAlertThresholds,
): DiskAlertLevel {
  if (availableBytes < thresholds.criticalBytes) return 'critical';
  if (previous === 'critical' && availableBytes < thresholds.criticalBytes + DISK_ALERT_RECOVERY_MARGIN_BYTES) {
    return 'critical';
  }
  if (availableBytes < thresholds.warningBytes) return 'warning';
  if (previous !== 'ok' && availableBytes < thresholds.warningBytes + DISK_ALERT_RECOVERY_MARGIN_BYTES) {
    return 'warning';
  }
  return 'ok';
}

/** True only when severity rises (ok→warning, ok→critical, warning→critical). */
export function isDiskAlertCrossing(previous: DiskAlertLevel, next: DiskAlertLevel): boolean {
  return LEVEL_RANK[next] > LEVEL_RANK[previous];
}

function formatGib(bytes: number): string {
  return (bytes / GIB).toFixed(1);
}

/** Replace the home directory prefix with `~`, like a shell prompt. */
function tildePath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * Build the one-shot edge notification for a crossing into `warning` or
 * `critical`. `since` is the ISO time the current non-ok level began, so
 * every crossing gets a distinct `tag` (the dispatcher dedups by tag for 24h).
 */
export function diskAlertPush(
  level: 'warning' | 'critical',
  availableBytes: number,
  thresholds: DiskAlertThresholds,
  path: string,
  since: string,
): EdgeNotification {
  const availableGib = formatGib(availableBytes);
  const displayPath = tildePath(path);
  const title = level === 'critical'
    ? `Disk critical · ${availableGib} GiB free`
    : `Disk low · ${availableGib} GiB free`;
  const body = level === 'critical'
    ? `Disk critical: ${availableGib} GiB free on the filesystem holding ${displayPath} `
      + `(critical below ${formatGib(thresholds.criticalBytes)} GiB). Writes may fail soon; free space now.`
    : `Disk low: ${availableGib} GiB free on the filesystem holding ${displayPath} `
      + `(alert below ${formatGib(thresholds.warningBytes)} GiB). Open Resources to free space.`;
  return {
    kind: 'failed',
    category: 'failed',
    tag: `disk:${level}:${since}`,
    title,
    publicTitle: title,
    body,
    url: '/m',
    issueId: null,
  };
}
