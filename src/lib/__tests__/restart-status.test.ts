import { Effect } from 'effect';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectConcurrentRestartWriters, readRestartEvents, readRestartStatus, writeRestartStatus } from '../restart-status.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;

describe('restart status', () => {
  beforeEach(() => {
    testHome = join(tmpdir(), `overdeck-restart-status-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    rmSync(testHome, { recursive: true, force: true });
  });

  it('returns null when the status file is missing', async () => {
    expect(await Effect.runPromise(readRestartStatus())).toBeNull();
  });

  it('writes and reads the latest restart status', async () => {
    await Effect.runPromise(writeRestartStatus({
      ts: '2026-05-17T15:00:00.000Z',
      trigger: 'watchdog',
      success: false,
      error: 'restart cap reached',
      durationMs: 1234,
      attempts: 3,
      gaveUp: true,
    }));

    expect(await Effect.runPromise(readRestartStatus())).toEqual({
      ts: '2026-05-17T15:00:00.000Z',
      trigger: 'watchdog',
      success: false,
      error: 'restart cap reached',
      durationMs: 1234,
      attempts: 3,
      gaveUp: true,
    });
    expect(existsSync(join(testHome, 'restart-status.json'))).toBe(true);
  });

  it('appends every write to a journal while restart-status.json keeps only the latest', async () => {
    const entryA = {
      ts: '2026-05-17T15:00:00.000Z',
      trigger: 'pan reload' as const,
      success: true,
      durationMs: 1000,
      attempts: 1,
      pid: 1001,
      initiator: 'conv-a',
    };
    const entryB = {
      ts: '2026-05-17T15:00:02.000Z',
      trigger: 'pan reload' as const,
      success: true,
      durationMs: 2000,
      attempts: 1,
      pid: 1002,
      initiator: 'conv-b',
    };

    await Effect.runPromise(writeRestartStatus(entryA));
    await Effect.runPromise(writeRestartStatus(entryB));

    expect(await Effect.runPromise(readRestartStatus())).toEqual(entryB);
    expect(await Effect.runPromise(readRestartEvents())).toEqual([entryA, entryB]);
  });

  it('detects concurrent restart writers within the window', () => {
    const baseTime = new Date('2026-05-17T15:00:00.000Z').getTime();
    const event = (offsetMs: number, pid: number) => ({
      ts: new Date(baseTime + offsetMs).toISOString(),
      trigger: 'pan reload' as const,
      success: true,
      durationMs: 1000,
      attempts: 1,
      pid,
    });

    expect(detectConcurrentRestartWriters([event(0, 1), event(2600, 2)])).toHaveLength(2);
    expect(detectConcurrentRestartWriters([event(0, 1), event(2600, 1)])).toHaveLength(0);
    expect(detectConcurrentRestartWriters([event(0, 1), event(61000, 2)])).toHaveLength(0);
    expect(detectConcurrentRestartWriters([event(0, 1), event(30000, 2), event(60000, 3)])).toHaveLength(3);
  });

  it('caps the journal to the most recent 200 entries', async () => {
    const baseTime = new Date('2026-05-17T15:00:00.000Z').getTime();
    for (let i = 0; i < 205; i++) {
      await Effect.runPromise(
        writeRestartStatus({
          ts: new Date(baseTime + i * 1000).toISOString(),
          trigger: 'watchdog',
          success: true,
          durationMs: i,
          attempts: 1,
          pid: i,
        }),
      );
    }

    const events = await Effect.runPromise(readRestartEvents());
    expect(events).toHaveLength(200);
    expect(events[0].pid).toBe(5);
    expect(events[199].pid).toBe(204);
  });

  it('does not fail the primary write when the journal path is unwritable', async () => {
    // Make the journal path unwritable by creating it as a directory.
    mkdirSync(join(testHome, 'restart-events.jsonl'), { recursive: true });

    const entry = {
      ts: '2026-05-17T15:00:00.000Z',
      trigger: 'pan reload' as const,
      success: true,
      durationMs: 1000,
      attempts: 1,
      pid: 1,
    };

    await expect(Effect.runPromise(writeRestartStatus(entry))).resolves.toBeUndefined();
    expect(await Effect.runPromise(readRestartStatus())).toEqual(entry);
  });
});
