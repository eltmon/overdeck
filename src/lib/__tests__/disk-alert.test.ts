import { describe, expect, it } from 'vitest';
import {
  DISK_ALERT_RECOVERY_MARGIN_BYTES,
  diskAlertPush,
  diskAlertThresholds,
  isDiskAlertCrossing,
  nextDiskAlertLevel,
  type DiskAlertThresholds,
} from '../disk-alert.js';
import type { DiskAlertLevel } from '@overdeck/contracts';

const GIB = 1024 ** 3;
const MARGIN = DISK_ALERT_RECOVERY_MARGIN_BYTES;
const THRESHOLDS: DiskAlertThresholds = { warningBytes: 5 * GIB, criticalBytes: 2 * GIB };

describe('diskAlertThresholds', () => {
  it('converts GiB config values to bytes', () => {
    expect(diskAlertThresholds({ diskWarnGb: 5, diskCriticalGb: 2 })).toEqual(THRESHOLDS);
  });
});

describe('nextDiskAlertLevel', () => {
  const cases: Array<[DiskAlertLevel, number, DiskAlertLevel]> = [
    // previous ok
    ['ok', 1 * GIB, 'critical'],
    ['ok', THRESHOLDS.criticalBytes, 'warning'],
    ['ok', 3 * GIB, 'warning'],
    ['ok', THRESHOLDS.warningBytes, 'ok'],
    ['ok', 10 * GIB, 'ok'],
    // previous warning
    ['warning', 1 * GIB, 'critical'],
    ['warning', THRESHOLDS.criticalBytes, 'warning'],
    ['warning', 3 * GIB, 'warning'],
    ['warning', THRESHOLDS.warningBytes + 0.3 * GIB, 'warning'],
    ['warning', THRESHOLDS.warningBytes + 0.6 * GIB, 'ok'],
    ['warning', THRESHOLDS.warningBytes + MARGIN, 'ok'],
    // previous critical
    ['critical', 1 * GIB, 'critical'],
    ['critical', THRESHOLDS.criticalBytes + 0.3 * GIB, 'critical'],
    ['critical', THRESHOLDS.criticalBytes + MARGIN, 'warning'],
    ['critical', 3 * GIB, 'warning'],
    ['critical', THRESHOLDS.warningBytes + 0.3 * GIB, 'warning'],
    ['critical', THRESHOLDS.warningBytes + 0.6 * GIB, 'ok'],
  ];

  for (const [previous, available, expected] of cases) {
    it(`${previous} at ${(available / GIB).toFixed(2)} GiB -> ${expected}`, () => {
      expect(nextDiskAlertLevel(previous, available, THRESHOLDS)).toBe(expected);
    });
  }
});

describe('isDiskAlertCrossing', () => {
  const rising: Array<[DiskAlertLevel, DiskAlertLevel]> = [
    ['ok', 'warning'],
    ['ok', 'critical'],
    ['warning', 'critical'],
  ];
  const notRising: Array<[DiskAlertLevel, DiskAlertLevel]> = [
    ['ok', 'ok'],
    ['warning', 'warning'],
    ['critical', 'critical'],
    ['warning', 'ok'],
    ['critical', 'warning'],
    ['critical', 'ok'],
  ];

  for (const [previous, next] of rising) {
    it(`${previous} -> ${next} is a crossing`, () => {
      expect(isDiskAlertCrossing(previous, next)).toBe(true);
    });
  }
  for (const [previous, next] of notRising) {
    it(`${previous} -> ${next} is not a crossing`, () => {
      expect(isDiskAlertCrossing(previous, next)).toBe(false);
    });
  }
});

describe('diskAlertPush', () => {
  const since = '2026-11-06T17:00:00.000Z';

  it('builds a critical notification', () => {
    const n = diskAlertPush('critical', 1.2 * GIB, THRESHOLDS, '/home/op/.overdeck', since);
    expect(n.kind).toBe('failed');
    expect(n.category).toBe('failed');
    expect(n.title).toBe('Disk critical · 1.2 GiB free');
    expect(n.publicTitle).toBe('Disk critical · 1.2 GiB free');
    expect(n.url).toBe('/m');
    expect(n.issueId).toBeNull();
    expect(n.tag).toBe(`disk:critical:${since}`);
  });

  it('builds a warning notification', () => {
    const n = diskAlertPush('warning', 4.1 * GIB, THRESHOLDS, '/home/op/.overdeck', since);
    expect(n.title).toBe('Disk low · 4.1 GiB free');
    expect(n.tag).toBe(`disk:warning:${since}`);
  });

  it('gives two different since values two different tags', () => {
    const a = diskAlertPush('warning', 4 * GIB, THRESHOLDS, '/home/op/.overdeck', '2026-11-06T17:00:00.000Z');
    const b = diskAlertPush('warning', 4 * GIB, THRESHOLDS, '/home/op/.overdeck', '2026-11-06T18:00:00.000Z');
    expect(a.tag).not.toBe(b.tag);
  });
});
