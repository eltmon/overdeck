import { Effect } from 'effect';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRestartStatus, writeRestartStatus } from '../restart-status.js';

const originalPanopticonHome = process.env.PANOPTICON_HOME;
let testHome: string;

describe('restart status', () => {
  beforeEach(() => {
    testHome = join(tmpdir(), `panopticon-restart-status-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.PANOPTICON_HOME = testHome;
  });

  afterEach(() => {
    if (originalPanopticonHome === undefined) {
      delete process.env.PANOPTICON_HOME;
    } else {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
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
});
