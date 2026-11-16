import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ShutdownDrainingError,
  assertNotShuttingDown,
  deleteShutdownRecord,
  isShutdownDrainingSync,
  readShutdownRecord,
  shutdownRecordPath,
  writeShutdownRecord,
  type ShutdownRecord,
} from '../../../../src/lib/shutdown/drain-record.js';

const record: ShutdownRecord = {
  version: 1,
  startedAt: '2026-11-15T20:00:00.000Z',
  deadlineAt: '2026-11-15T20:02:00.000Z',
  reboot: false,
  force: 'never',
  phase: 'draining',
  stopped: [{ kind: 'agent', id: 'agent-pan-1', issueId: 'PAN-1', label: 'PAN-1 work agent', wasWorking: true }],
};

describe('shutdown record (PAN-5342 WI-1)', () => {
  let previousHome: string | undefined;
  let home: string;

  beforeEach(() => {
    previousHome = process.env.OVERDECK_HOME;
    home = mkdtempSync(join(tmpdir(), 'pan-5342-drain-record-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('lives under OVERDECK_HOME', () => {
    expect(shutdownRecordPath()).toBe(join(home, 'shutdown.json'));
  });

  it('round-trips write, read and delete', async () => {
    expect(await readShutdownRecord()).toBeNull();
    await writeShutdownRecord(record);
    expect(isShutdownDrainingSync()).toBe(true);
    expect(await readShutdownRecord()).toEqual(record);
    expect(existsSync(`${shutdownRecordPath()}.${process.pid}.tmp`)).toBe(false);
    await deleteShutdownRecord();
    expect(isShutdownDrainingSync()).toBe(false);
    await expect(deleteShutdownRecord()).resolves.toBeUndefined();
  });

  it('throws ShutdownDrainingError only while the record exists', async () => {
    expect(() => assertNotShuttingDown()).not.toThrow();
    await writeShutdownRecord(record);
    expect(() => assertNotShuttingDown()).toThrow(ShutdownDrainingError);
    try {
      assertNotShuttingDown();
    } catch (err) {
      expect((err as ShutdownDrainingError).code).toBe('shutdown-draining');
      expect((err as Error).message).toContain('pan shutdown');
    }
    await deleteShutdownRecord();
    expect(() => assertNotShuttingDown()).not.toThrow();
  });

  it('reads bad JSON as null while still counting as draining', async () => {
    writeFileSync(shutdownRecordPath(), '{not json');
    expect(await readShutdownRecord()).toBeNull();
    expect(isShutdownDrainingSync()).toBe(true);
  });
});
