import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmitActivityOptions } from '../../../../lib/activity-logger.js';
import type { RestartStatus } from '../../../../lib/restart-status.js';
import {
  announceNewRestart,
  describeRestart,
  initiatorLink,
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
    readSupervisorUnitFailed: () => Promise<boolean>;
    writeStatus: (status: RestartStatus) => Promise<void>;
    emit: (options: EmitActivityOptions) => void;
    getLastAnnounced: () => string | null;
    setLastAnnounced: (ts: string) => void;
    now: () => number;
    platform: NodeJS.Platform;
    probeSupervisor: () => Promise<boolean>;
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
      readSupervisorUnitFailed: async () => false,
      writeStatus: async (next) => { status = next; },
      emit: (options) => emitted.push(options),
      getLastAnnounced: () => stored,
      setLastAnnounced: (ts) => { stored = ts; },
      now: () => ONE_MINUTE_LATER,
      platform: 'linux' as NodeJS.Platform,
      probeSupervisor: async () => true,
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
    expect(entry.link).toBeUndefined();
  });

  it('attributes a conversation-initiated reload and links to its conversation ID page', () => {
    // The initiator is a tmux session NAME; /conv/:key resolves only numeric
    // conversation ids, so the announcer resolves through the conversations DB.
    const resolve = (tmux: string) =>
      tmux === 'conv-20260610-8858' ? { id: 2671, title: 'Live UAT merge train validation run' } : null;
    const entry = describeRestart({
      ...watchdogSuccess,
      trigger: 'pan reload',
      reason: undefined,
      initiator: 'conv-20260610-8858',
    }, resolve);
    expect(entry.message).toBe('Dashboard restarted via pan reload by conversation 2671 ("Live UAT merge train validation run") (13.5s)');
    expect(entry.link).toBe('/conv/2671');
  });

  it('falls back to the session name with no link when the conversation cannot be resolved', () => {
    const entry = describeRestart({
      ...watchdogSuccess,
      trigger: 'pan reload',
      reason: undefined,
      initiator: 'conv-20260610-9999',
    }, () => null);
    expect(entry.message).toBe('Dashboard restarted via pan reload by conversation 20260610-9999 (13.5s)');
    expect(entry.link).toBeUndefined();
  });

  it('links flywheel-orchestrator reloads to the flywheel page', () => {
    const entry = describeRestart({
      ...watchdogSuccess,
      trigger: 'pan reload',
      reason: undefined,
      initiator: 'conv-flywheel-orchestrator',
    });
    expect(entry.message).toContain('by the flywheel orchestrator');
    expect(entry.link).toBe('/flywheel');
  });

  it('attributes agent-initiated restarts via issueId so the feed routes to the issue', () => {
    const entry = describeRestart({
      ...watchdogSuccess,
      trigger: 'pan restart',
      reason: undefined,
      initiator: 'agent-pan-1647-review',
      issueId: 'PAN-1647',
    });
    expect(entry.message).toContain('by agent-pan-1647-review');
    expect(entry.issueId).toBe('PAN-1647');
    expect(entry.link).toBeUndefined();
  });
});

describe('initiatorLink', () => {
  const resolve = (tmux: string) => (tmux === 'conv-20260610-8858' ? { id: 42 } : null);
  it.each([
    [undefined, undefined],
    ['conv-flywheel-orchestrator', '/flywheel'],
    ['conv-20260610-8858', '/conv/42'],
    ['conv-20260610-0000', undefined],
    ['agent-pan-1647', undefined],
  ])('%s -> %s', (initiator, expected) => {
    expect(initiatorLink(initiator, resolve)).toBe(expected);
  });
});

describe('announceNewRestart', () => {
  afterEach(() => { stopRestartAnnouncer(); });

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

  it('does not announce the pre-SIGTERM stopping phase as a failed restart', async () => {
    const t = makeDeps({
      ...watchdogSuccess,
      trigger: 'pan reload',
      success: false,
      phase: 'stopping',
      initiator: 'deploy-patrol',
    });

    expect(await announceNewRestart(t.deps)).toBe(false);
    expect(t.emitted).toHaveLength(0);
    expect(t.lastAnnounced()).toBeNull();
  });

  it('records but does not announce a stale restart', async () => {
    const t = makeDeps();
    const twoHoursLater = Date.parse(RESTART_TS) + 2 * 60 * 60_000;

    expect(await announceNewRestart({ ...t.deps, now: () => twoHoursLater })).toBe(false);
    expect(t.emitted).toHaveLength(0);
    expect(t.lastAnnounced()).toBe(RESTART_TS);
  });

  it('does not persist the announced ts when emitting fails', async () => {
    const t = makeDeps();

    await expect(announceNewRestart({
      ...t.deps,
      emit: () => { throw new Error('event store not ready'); },
    })).rejects.toThrow('event store not ready');

    expect(t.lastAnnounced()).toBeNull();

    expect(await announceNewRestart(t.deps)).toBe(true);
    expect(t.emitted).toHaveLength(1);
    expect(t.lastAnnounced()).toBe(RESTART_TS);
  });

  it('emits one supervisor give-up entry when the systemd unit is failed', async () => {
    const t = makeDeps(null);
    const written: RestartStatus[] = [];

    expect(await announceNewRestart({
      ...t.deps,
      readSupervisorUnitFailed: async () => true,
      writeStatus: async (status) => {
        written.push(status);
        t.setStatus(status);
      },
    })).toBe(true);

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      trigger: 'watchdog',
      success: false,
      gaveUp: true,
      reason: 'supervisor-unit-failed',
    });
    expect(written[0].error).toContain('overdeck-supervisor.service');
    expect(t.emitted).toHaveLength(1);
    expect(t.emitted[0].level).toBe('error');
    expect(t.emitted[0].message).toContain('GAVE UP');
    expect(t.emitted[0].message).toContain('manual intervention required');

    expect(await announceNewRestart({
      ...t.deps,
      readSupervisorUnitFailed: async () => true,
      writeStatus: async (status) => {
        written.push(status);
        t.setStatus(status);
      },
    })).toBe(false);

    expect(written).toHaveLength(1);
    expect(t.emitted).toHaveLength(1);
  });

  it('does not emit a supervisor give-up entry when the systemd unit is not failed', async () => {
    const t = makeDeps(null);
    const writeStatus = vi.fn(async (status: RestartStatus) => {
      t.setStatus(status);
    });

    expect(await announceNewRestart({
      ...t.deps,
      readSupervisorUnitFailed: async () => false,
      writeStatus,
    })).toBe(false);

    expect(writeStatus).not.toHaveBeenCalled();
    expect(t.emitted).toHaveLength(0);
  });
});

describe('announceNewRestart on darwin (PAN-5170)', () => {
  afterEach(() => { stopRestartAnnouncer(); });

  it('never calls the systemd path and emits nothing when the probe answers', async () => {
    const t = makeDeps(null);
    const readSupervisorUnitFailed = vi.fn(async () => true);
    const writeStatus = vi.fn(async (status: RestartStatus) => { t.setStatus(status); });

    expect(await announceNewRestart({
      ...t.deps,
      platform: 'darwin',
      supervisorUrl: () => 'http://127.0.0.1:3012',
      probeSupervisor: async () => true,
      readSupervisorUnitFailed,
      writeStatus,
    })).toBe(false);

    expect(readSupervisorUnitFailed).not.toHaveBeenCalled();
    expect(writeStatus).not.toHaveBeenCalled();
    expect(t.emitted).toHaveLength(0);
  });

  it('emits exactly one supervisor-down row after 60 s unreachable, then nothing more', async () => {
    const t = makeDeps(null);
    const T = Date.parse(RESTART_TS);
    let answered = true;

    const pass = (nowMs: number) => announceNewRestart({
      ...t.deps,
      platform: 'darwin',
      supervisorUrl: () => 'http://127.0.0.1:3012',
      probeSupervisor: async () => answered,
      now: () => nowMs,
    });

    await pass(T);
    expect(t.emitted).toHaveLength(0);

    answered = false;
    await pass(T + 1_000);
    expect(t.emitted).toHaveLength(0);

    await pass(T + 61_000);
    expect(t.emitted).toHaveLength(1);
    expect(t.emitted[0].source).toBe('supervisor');
    expect(t.emitted[0].level).toBe('error');
    expect(t.emitted[0].message).toContain('http://127.0.0.1:3012');
    expect(t.emitted[0].message).toContain('has not answered for 60 s');
    expect(t.emitted[0].message).toContain('pan up');

    await pass(T + 120_000);
    expect(t.emitted).toHaveLength(1);
  });

  it('emits nothing across 10 minutes of passes when the supervisor never answers', async () => {
    const t = makeDeps(null);
    const T = Date.parse(RESTART_TS);

    for (let elapsed = 0; elapsed <= 10 * 60_000; elapsed += 15_000) {
      await announceNewRestart({
        ...t.deps,
        platform: 'darwin',
        supervisorUrl: () => 'http://127.0.0.1:3012',
        probeSupervisor: async () => false,
        now: () => T + elapsed,
      });
    }

    expect(t.emitted).toHaveLength(0);
  });

  it('never touches restart-status.json while reporting a down supervisor', async () => {
    const t = makeDeps(null);
    const writeStatus = vi.fn(async (status: RestartStatus) => { t.setStatus(status); });
    const T = Date.parse(RESTART_TS);
    let answered = true;

    const pass = (nowMs: number) => announceNewRestart({
      ...t.deps,
      platform: 'darwin',
      supervisorUrl: () => 'http://127.0.0.1:3012',
      probeSupervisor: async () => answered,
      writeStatus,
      now: () => nowMs,
    });

    await pass(T);
    answered = false;
    await pass(T + 1_000);
    await pass(T + 61_000);

    expect(writeStatus).not.toHaveBeenCalled();
  });
});

describe('startRestartAnnouncer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    stopRestartAnnouncer();
    vi.useRealTimers();
  });

  it('announces a restart status that appears after boot on the fast bootstrap poll, exactly once', async () => {
    const t = makeDeps(null);
    startRestartAnnouncer(t.deps);

    await vi.advanceTimersByTimeAsync(0);
    expect(t.emitted).toHaveLength(0);

    t.setStatus(watchdogSuccess);
    await vi.advanceTimersByTimeAsync(999);
    expect(t.emitted).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(t.emitted).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(t.emitted).toHaveLength(1);
  });

  // PAN-3931: a peer shares the primary's settings and restart-status.json. If
  // it ran, it would record the primary's restart as announced (so the primary
  // never announces it) and write the supervisor give-up status.
  it('starts nothing in a peer dashboard and writes no restart state', async () => {
    const t = makeDeps(watchdogSuccess);
    const readStatus = vi.fn(t.deps.readStatus);
    const writeStatus = vi.fn(t.deps.writeStatus);
    const setLastAnnounced = vi.fn(t.deps.setLastAnnounced);

    expect(startRestartAnnouncer({
      ...t.deps,
      readStatus,
      writeStatus,
      setLastAnnounced,
      readSupervisorUnitFailed: async () => true,
      isPeer: () => true,
    })).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(readStatus).not.toHaveBeenCalled();
    expect(writeStatus).not.toHaveBeenCalled();
    expect(setLastAnnounced).not.toHaveBeenCalled();
    expect(t.lastAnnounced()).toBeNull();
    expect(t.emitted).toHaveLength(0);
  });

  it('starts in the primary dashboard', async () => {
    const t = makeDeps(watchdogSuccess);
    expect(startRestartAnnouncer({ ...t.deps, isPeer: () => false })).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.lastAnnounced()).toBe(RESTART_TS);
    expect(t.emitted).toHaveLength(1);
  });
});
