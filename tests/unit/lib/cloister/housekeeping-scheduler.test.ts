/**
 * PAN-3894 (W2): the housekeeping scheduler runs chores at fast/hourly/daily
 * cadences with durable due-times, single-flight, a pause skip, per-chore error
 * isolation, and budgeted runs.
 *
 * Every cadence assertion uses fake timers — no real waits (repo rule:
 * fake-timers-for-retry-tests).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runHousekeepingTick,
  startHousekeepingScheduler,
  stopHousekeepingScheduler,
  readHousekeepingState,
  isChoreDue,
  listHousekeepingRows,
  HOUSEKEEPING_SCHEDULER_TICK_MS,
  type HousekeepingDeps,
} from '../../../../src/lib/cloister/housekeeping-scheduler.js';
import type { ChoreContext, HousekeepingChore } from '../../../../src/lib/cloister/patrol-registry.js';

const T0 = Date.UTC(2026, 8, 18, 12, 0, 0);

let tmp: string;
let statePath: string;

function ctx(): ChoreContext {
  return {
    deacon: {
      checkAndSuspendIdleAgents: vi.fn(async () => []),
      checkMergedWorkSessions: vi.fn(async () => []),
      checkWorkspaceContainerHealth: vi.fn(async () => []),
      cleanupStaleAgentState: vi.fn(async () => []),
    },
  };
}

function makeDeps(
  chores: readonly HousekeepingChore[],
  overrides: Partial<HousekeepingDeps> = {},
): { deps: HousekeepingDeps; log: ReturnType<typeof vi.fn>; clock: { ms: number } } {
  const log = vi.fn();
  const clock = { ms: T0 };
  const deps: HousekeepingDeps = {
    context: ctx(),
    chores,
    now: () => clock.ms,
    isPaused: async () => false,
    log,
    statePath,
    ...overrides,
  };
  return { deps, log, clock };
}

beforeEach(() => {
  vi.useFakeTimers();
  tmp = mkdtempSync(join(tmpdir(), 'pan3894-housekeeping-'));
  statePath = join(tmp, 'deacon', 'housekeeping.json');
  stopHousekeepingScheduler();
});

afterEach(() => {
  stopHousekeepingScheduler();
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

describe('housekeeping scheduler cadences (PAN-3894 W2)', () => {
  it('runs a never-run chore on the first tick and persists its lastRunAt', async () => {
    const run = vi.fn(async () => ['did the thing']);
    const { deps } = makeDeps([{ name: 'fastChore', cadence: 'fast', run }]);

    const actions = await runHousekeepingTick(deps);

    expect(run).toHaveBeenCalledTimes(1);
    expect(actions).toEqual(['did the thing']);
    expect(readHousekeepingState(statePath).lastRunAt.fastChore).toBe(new Date(T0).toISOString());
  });

  it('holds a fast chore for 5 minutes and an hourly chore for 60 minutes', async () => {
    const fast = vi.fn(async () => []);
    const hourly = vi.fn(async () => []);
    const { deps, clock } = makeDeps([
      { name: 'fastChore', cadence: 'fast', run: fast },
      { name: 'hourlyChore', cadence: 'hourly', run: hourly },
    ]);

    await runHousekeepingTick(deps);
    expect(fast).toHaveBeenCalledTimes(1);
    expect(hourly).toHaveBeenCalledTimes(1);

    clock.ms = T0 + 4 * 60_000;
    await runHousekeepingTick(deps);
    expect(fast).toHaveBeenCalledTimes(1);

    clock.ms = T0 + 5 * 60_000;
    await runHousekeepingTick(deps);
    expect(fast).toHaveBeenCalledTimes(2);
    expect(hourly).toHaveBeenCalledTimes(1);

    clock.ms = T0 + 60 * 60_000;
    await runHousekeepingTick(deps);
    expect(hourly).toHaveBeenCalledTimes(2);
  });

  it('honors a lastRunAt written by a previous process', async () => {
    mkdirSync(join(tmp, 'deacon'), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({ version: 1, lastRunAt: { hourlyChore: new Date(T0 - 30 * 60_000).toISOString() } }),
      'utf8',
    );

    const hourly = vi.fn(async () => []);
    const { deps } = makeDeps([{ name: 'hourlyChore', cadence: 'hourly', run: hourly }]);

    await runHousekeepingTick(deps);

    expect(hourly).not.toHaveBeenCalled();
  });

  it('treats a missing or torn state file as "nothing has ever run"', () => {
    expect(readHousekeepingState(join(tmp, 'absent.json'))).toEqual({ version: 1, lastRunAt: {} });
    mkdirSync(join(tmp, 'deacon'), { recursive: true });
    writeFileSync(statePath, '{"version":1,"lastRu', 'utf8');
    expect(readHousekeepingState(statePath)).toEqual({ version: 1, lastRunAt: {} });
  });

  it('isChoreDue is true for an unparseable lastRunAt', () => {
    const chore: HousekeepingChore = { name: 'x', cadence: 'daily', run: async () => [] };
    expect(isChoreDue(chore, { version: 1, lastRunAt: { x: 'not-a-date' } }, T0)).toBe(true);
  });
});

describe('housekeeping scheduler isolation and pausing (PAN-3894 W2)', () => {
  it('logs a throwing chore at warn, keeps running later chores, and still stamps the thrower', async () => {
    const boom = vi.fn(async () => {
      throw new Error('chore exploded');
    });
    const after = vi.fn(async () => ['after ran']);
    const { deps, log } = makeDeps([
      { name: 'boomChore', cadence: 'fast', run: boom },
      { name: 'afterChore', cadence: 'fast', run: after },
    ]);

    const actions = await runHousekeepingTick(deps);

    expect(log).toHaveBeenCalledWith('warn', 'Housekeeping chore boomChore failed: chore exploded');
    expect(after).toHaveBeenCalledTimes(1);
    expect(actions).toEqual(['after ran']);
    expect(readHousekeepingState(statePath).lastRunAt.boomChore).toBe(new Date(T0).toISOString());
  });

  it('runs no chore while the deacon is globally paused and logs the skip once per pause span', async () => {
    const run = vi.fn(async () => []);
    const paused = { value: true };
    const { deps, log } = makeDeps([{ name: 'fastChore', cadence: 'fast', run }], {
      isPaused: async () => paused.value,
    });

    await runHousekeepingTick(deps);
    await runHousekeepingTick(deps);

    expect(run).not.toHaveBeenCalled();
    const infoLogs = log.mock.calls.filter(([level]) => level === 'info');
    expect(infoLogs).toHaveLength(1);

    paused.value = false;
    await runHousekeepingTick(deps);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('logs a [warn]-prefixed action at warn level with the prefix stripped', async () => {
    const { deps, log } = makeDeps([
      { name: 'specialistChore', cadence: 'fast', run: async () => ['[warn] specialist stuck, force-killing', 'killed it'] },
    ]);

    await runHousekeepingTick(deps);

    expect(log).toHaveBeenCalledWith('warn', 'specialist stuck, force-killing');
    expect(log).toHaveBeenCalledWith('action', 'killed it');
  });

  it('passes the chore name to runBudgeted and logs every returned action', async () => {
    const runBudgeted = vi.fn(async (_name: string, fn: () => Promise<string[]>) => fn());
    const { deps, log } = makeDeps([{ name: 'fastChore', cadence: 'fast', run: async () => ['a', 'b'] }], {
      runBudgeted: runBudgeted as unknown as HousekeepingDeps['runBudgeted'],
    });

    await runHousekeepingTick(deps);

    expect(runBudgeted).toHaveBeenCalledWith('fastChore', expect.any(Function));
    expect(log).toHaveBeenCalledWith('action', 'a');
    expect(log).toHaveBeenCalledWith('action', 'b');
  });

  it('does not overlap itself: a second interval fire while the first tick is in flight is dropped', async () => {
    let release: (() => void) | undefined;
    const started = vi.fn();
    const slow = vi.fn(async () => {
      started();
      await new Promise<void>((r) => {
        release = r;
      });
      return [];
    });
    const { deps } = makeDeps([{ name: 'slowChore', cadence: 'fast', run: slow }]);

    startHousekeepingScheduler(deps);

    await vi.advanceTimersByTimeAsync(HOUSEKEEPING_SCHEDULER_TICK_MS);
    expect(started).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOUSEKEEPING_SCHEDULER_TICK_MS);
    expect(started).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('startHousekeepingScheduler is idempotent and stop clears the interval', async () => {
    const run = vi.fn(async () => []);
    const { deps } = makeDeps([{ name: 'fastChore', cadence: 'fast', run }]);

    startHousekeepingScheduler(deps);
    startHousekeepingScheduler(deps);

    await vi.advanceTimersByTimeAsync(HOUSEKEEPING_SCHEDULER_TICK_MS);
    expect(run).toHaveBeenCalledTimes(1);

    stopHousekeepingScheduler();
    await vi.advanceTimersByTimeAsync(HOUSEKEEPING_SCHEDULER_TICK_MS * 10);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('listHousekeepingRows (PAN-3894 W2)', () => {
  it('computes nextDueAt as lastRunAt + cadence, and null for a chore that has never run', () => {
    mkdirSync(join(tmp, 'deacon'), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({ version: 1, lastRunAt: { ranChore: new Date(T0).toISOString() } }),
      'utf8',
    );

    const rows = listHousekeepingRows(T0, statePath, [
      { name: 'ranChore', cadence: 'hourly', trigger: 'issue.statusChanged (closed)', run: async () => [] },
      { name: 'neverChore', cadence: 'daily', run: async () => [] },
    ]);

    expect(rows[0]).toEqual({
      name: 'ranChore',
      cadence: 'hourly',
      trigger: 'issue.statusChanged (closed)',
      lastRunAt: new Date(T0).toISOString(),
      nextDueAt: new Date(T0 + 60 * 60_000).toISOString(),
    });
    expect(rows[1]).toEqual({
      name: 'neverChore',
      cadence: 'daily',
      lastRunAt: null,
      nextDueAt: null,
    });
  });
});
