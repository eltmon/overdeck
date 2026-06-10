import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmitActivityOptions } from '../../../../lib/activity-logger.js';
import type { RestartStatus } from '../../../../lib/restart-status.js';
import {
  announceNewRestart,
  describeRestart,
  startRestartAnnouncer,
  stopRestartAnnouncer,
} from '../restart-announcer.js';

const RESTART_TS = '2026-06-10T01:00:00.000Z';
const ONE_MINUTE_LATER = Date.parse(RESTART_TS) + 60_000;

const watchdogSuccess: RestartStatus = {
  ts: RESTART_TS,
  trigger: 'watchdog',
  success: true,
  durationMs: 13_524,
  attempts: 1,
  reason: 'sustained health-probe timeouts: health check timed out',
};

interface TestDeps {
  emitted: EmitActivityOptions[];
  deps: {
    readStatus: () => Promise<RestartStatus | null>;
    emit: (options: EmitActivityOptions) => void;
    getLastAnnounced: () => string | null;
    setLastAnnounced: (ts: string) => void;
    now: () => number;
  };
  setStatus: (status: RestartStatus | null) => void;
  lastAnnounced: () => string | null;
}

function makeDeps(initial: RestartStatus | null = watchdogSuccess): TestDeps {
  const emitted: EmitActivityOptions[] = [];
  let status = initial;
  let stored: string | null = null;
  return {
    emitted,
    deps: {
      readStatus: async () => status,
      emit: (options) => emitted.push(options),
      getLastAnnounced: () => stored,
      setLastAnnounced: (ts) => { stored = ts; },
      now: () => ONE_MINUTE_LATER,
    },
    setStatus: (next) => { status = next; },
    lastAnnounced: () => stored,
  };
}

describe('describeRestart', () => {
  it('maps a successful watchdog restart to a supervisor warn entry with the reason', () => {
    const entry = describeRestart(watchdogSuccess);
    expect(entry.source).toBe('supervisor');
    expect(entry.level).toBe('warn');
    expect(entry.message).toContain('Supervisor watchdog restarted the dashboard');
    expect(entry.message).toContain('sustained health-probe timeouts');
  });

  it('maps a watchdog give-up to a supervisor error entry', () => {
    const entry = describeRestart({
      ...watchdogSuccess,
      success: false,
      gaveUp: true,
      attempts: 3,
      error: 'WATCHDOG GIVING UP — manual intervention required: timeout',
    });
    expect(entry.source).toBe('supervisor');
    expect(entry.level).toBe('error');
    expect(entry.message).toContain('GAVE UP');
    expect(entry.details).toContain('manual intervention');
  });

  it('maps a failed watchdog restart to a supervisor error entry', () => {
    const entry = describeRestart({
      ...watchdogSuccess,
      success: false,
      error: 'pan restart exited with code 1',
    });
    expect(entry.level).toBe('error');
    expect(entry.message).toContain('restart failed');
    expect(entry.details).toBe('pan restart exited with code 1');
  });

  it('maps manual restarts to dashboard info entries', () => {
    const entry = describeRestart({ ...watchdogSuccess, trigger: 'pan reload', reason: undefined });
    expect(entry.source).toBe('dashboard');
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('Dashboard restarted via pan reload (13.5s)');
  });
});

describe('announceNewRestart', () => {
  it('emits once for a new restart status and persists the announced ts', async () => {
    const t = makeDeps();

    expect(await announceNewRestart(t.deps)).toBe(true);
    expect(t.emitted).toHaveLength(1);
    expect(t.lastAnnounced()).toBe(RESTART_TS);

    expect(await announceNewRestart(t.deps)).toBe(false);
    expect(t.emitted).toHaveLength(1);
  });

  it('returns false when no restart status exists', async () => {
    const t = makeDeps(null);
    expect(await announceNewRestart(t.deps)).toBe(false);
    expect(t.emitted).toHaveLength(0);
  });

  it('records but does not announce a stale restart', async () => {
    const t = makeDeps();
    const twoHoursLater = Date.parse(RESTART_TS) + 2 * 60 * 60_000;

    expect(await announceNewRestart({ ...t.deps, now: () => twoHoursLater })).toBe(false);
    expect(t.emitted).toHaveLength(0);
    expect(t.lastAnnounced()).toBe(RESTART_TS);
  });
});

describe('startRestartAnnouncer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    stopRestartAnnouncer();
    vi.useRealTimers();
  });

  it('announces a restart status that appears after boot, exactly once', async () => {
    const t = makeDeps(null);
    startRestartAnnouncer(t.deps);

    await vi.advanceTimersByTimeAsync(0);
    expect(t.emitted).toHaveLength(0);

    t.setStatus(watchdogSuccess);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.emitted).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(t.emitted).toHaveLength(1);
  });
});
