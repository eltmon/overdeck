/**
 * PAN-3850 (W39, FR-26): per-patrol firing budgets.
 *
 * A patrol whose action tally crosses its budget is suspended for the rest of
 * the UTC day and emits exactly one needs-you; the next UTC day it runs
 * again. Exempt alarm patrols (Appendix C #3, #64, #70, #71, #77) tally but
 * never suspend. Delays and the day boundary are driven by fake timers —
 * never real sleeps (rule `fake-timers-for-retry-tests`).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEmitActivityEntryOnce = vi.hoisted(() => vi.fn());
const mockLoadCloisterConfigSync = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/activity-logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/activity-logger.js')>()),
  emitActivityEntryOnce: mockEmitActivityEntryOnce,
}));
vi.mock('../../../../src/lib/cloister/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/cloister/config.js')>()),
  loadCloisterConfigSync: mockLoadCloisterConfigSync,
}));

import {
  DEFAULT_PATROL_ACTIONS_PER_DAY,
  getPatrolBudget,
  isPatrolSuspended,
  listPatrolBudgetRows,
  patrolBudgetFilePath,
  readPatrolBudgetState,
  recordPatrolActions,
  runBudgetedPatrol,
  suspendPatrol,
  utcDayKey,
} from '../../../../src/lib/cloister/patrol-budget.js';
import type { PatrolBudgetsConfig } from '../../../../src/lib/cloister/config.js';

const BUDGETS: PatrolBudgetsConfig = {
  default: 50,
  exempt: ['runStallSweeperPatrol'],
  overrides: { chattyPatrol: 2 },
};

/** 2026-09-17T12:00:00Z — mid-day, so small movements never cross midnight. */
const DAY_ONE = new Date('2026-09-17T12:00:00.000Z');
const DAY_TWO = new Date('2026-09-18T00:00:01.000Z');

describe('patrol firing budgets (PAN-3850 W39)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(DAY_ONE);
    home = mkdtempSync(join(tmpdir(), 'pan-patrol-budget-'));
    process.env.OVERDECK_HOME = home;
    mockEmitActivityEntryOnce.mockReset();
    mockEmitActivityEntryOnce.mockResolvedValue('appended');
    mockLoadCloisterConfigSync.mockReset();
    mockLoadCloisterConfigSync.mockReturnValue({ patrolBudgets: BUDGETS });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('utcDayKey is the UTC calendar day', () => {
    expect(utcDayKey(DAY_ONE)).toBe('2026-09-17');
    expect(utcDayKey(DAY_TWO)).toBe('2026-09-18');
  });

  it('recordPatrolActions tallies per UTC day and persists to the state file', () => {
    expect(recordPatrolActions('checkDeadEndAgents', 3, DAY_ONE)).toBe(3);
    expect(recordPatrolActions('checkDeadEndAgents', 2, DAY_ONE)).toBe(5);
    expect(recordPatrolActions('checkDeadEndAgents', 7, DAY_TWO)).toBe(7);

    const state = readPatrolBudgetState();
    expect(state.days['2026-09-17']?.checkDeadEndAgents?.actions).toBe(5);
    expect(state.days['2026-09-18']?.checkDeadEndAgents?.actions).toBe(7);

    // Zero-action passes are free.
    expect(recordPatrolActions('checkDeadEndAgents', 0, DAY_ONE)).toBe(5);
  });

  it('getPatrolBudget resolves override, then default', () => {
    expect(getPatrolBudget('chattyPatrol', BUDGETS)).toBe(2);
    expect(getPatrolBudget('checkDeadEndAgents', BUDGETS)).toBe(50);
    expect(DEFAULT_PATROL_ACTIONS_PER_DAY).toBe(50);
  });

  it('a patrol over budget is suspended: the 52nd call does not run and exactly one needs-you is recorded', async () => {
    const fn = vi.fn(async () => ['acted']);
    for (let i = 0; i < 51; i++) {
      const actions = await runBudgetedPatrol('checkDeadEndAgents', fn, { config: BUDGETS });
      expect(actions).toEqual(['acted']);
    }
    expect(fn).toHaveBeenCalledTimes(51);
    expect(isPatrolSuspended('checkDeadEndAgents', DAY_ONE, BUDGETS)).toBe(true);
    expect(mockEmitActivityEntryOnce).toHaveBeenCalledTimes(1);
    expect(mockEmitActivityEntryOnce.mock.calls[0]?.[0]).toMatchObject({
      id: 'patrol-budget-exceeded:checkDeadEndAgents:2026-09-17',
      level: 'error',
    });

    // The 52nd call is skipped entirely — the patrol body never runs.
    const skipped = await runBudgetedPatrol('checkDeadEndAgents', fn, { config: BUDGETS });
    expect(skipped).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(51);

    // A repeated suspension in the same day does not re-emit the needs-you.
    await suspendPatrol('checkDeadEndAgents', 'fired 52 actions in one UTC day (budget 50)', DAY_ONE);
    expect(mockEmitActivityEntryOnce).toHaveBeenCalledTimes(1);
  });

  it('a suspended patrol runs again on the next UTC day', async () => {
    const fn = vi.fn(async () => ['acted']);
    for (let i = 0; i < 51; i++) await runBudgetedPatrol('checkDeadEndAgents', fn, { config: BUDGETS });
    expect(isPatrolSuspended('checkDeadEndAgents', DAY_ONE, BUDGETS)).toBe(true);

    vi.setSystemTime(DAY_TWO);
    expect(isPatrolSuspended('checkDeadEndAgents', DAY_TWO, BUDGETS)).toBe(false);
    const actions = await runBudgetedPatrol('checkDeadEndAgents', fn, { config: BUDGETS });
    expect(actions).toEqual(['acted']);
    expect(fn).toHaveBeenCalledTimes(52);
  });

  it('an exempt alarm patrol exceeds the budget without suspending and without a needs-you', async () => {
    const fn = vi.fn(async () => ['alarm']);
    for (let i = 0; i < 60; i++) {
      const actions = await runBudgetedPatrol('runStallSweeperPatrol', fn, { config: BUDGETS });
      expect(actions).toEqual(['alarm']);
    }
    expect(fn).toHaveBeenCalledTimes(60);
    expect(isPatrolSuspended('runStallSweeperPatrol', DAY_ONE, BUDGETS)).toBe(false);
    expect(mockEmitActivityEntryOnce).not.toHaveBeenCalled();
    // The tally still accrues for the doctor table.
    expect(readPatrolBudgetState().days['2026-09-17']?.runStallSweeperPatrol?.actions).toBe(60);
  });

  it('a per-patrol override suspends a chatty patrol after its smaller budget', async () => {
    const fn = vi.fn(async () => ['x', 'y']);
    await runBudgetedPatrol('chattyPatrol', fn, { config: BUDGETS }); // tally 2 — at budget, still allowed
    expect(isPatrolSuspended('chattyPatrol', DAY_ONE, BUDGETS)).toBe(false);
    await runBudgetedPatrol('chattyPatrol', fn, { config: BUDGETS }); // tally 4 — over budget 2
    expect(isPatrolSuspended('chattyPatrol', DAY_ONE, BUDGETS)).toBe(true);
    expect(mockEmitActivityEntryOnce).toHaveBeenCalledTimes(1);
  });

  it('suspension persists in the state file (survives a fresh read)', async () => {
    await suspendPatrol('checkDeadEndAgents', 'test suspension', DAY_ONE);
    const state = readPatrolBudgetState();
    expect(state.days['2026-09-17']?.checkDeadEndAgents?.suspendedReason).toBe('test suspension');
    expect(state.days['2026-09-17']?.checkDeadEndAgents?.needsYouEmittedAt).toBeDefined();
    expect(isPatrolSuspended('checkDeadEndAgents', DAY_ONE, BUDGETS)).toBe(true);
  });

  it('a failed needs-you emit still suspends; the flag is retried on the next suspension attempt', async () => {
    mockEmitActivityEntryOnce.mockResolvedValue('failed');
    await suspendPatrol('checkDeadEndAgents', 'fired 51 actions', DAY_ONE);
    expect(isPatrolSuspended('checkDeadEndAgents', DAY_ONE, BUDGETS)).toBe(true);
    expect(readPatrolBudgetState().days['2026-09-17']?.checkDeadEndAgents?.needsYouEmittedAt).toBeUndefined();

    mockEmitActivityEntryOnce.mockResolvedValue('appended');
    await suspendPatrol('checkDeadEndAgents', 'fired 52 actions', DAY_ONE);
    expect(readPatrolBudgetState().days['2026-09-17']?.checkDeadEndAgents?.needsYouEmittedAt).toBeDefined();
    expect(mockEmitActivityEntryOnce).toHaveBeenCalledTimes(2);
  });

  it('listPatrolBudgetRows reports tally, budget and suspension for the doctor table', async () => {
    recordPatrolActions('runStallSweeperPatrol', 60, DAY_ONE);
    await suspendPatrol('checkDeadEndAgents', 'fired 51 actions in one UTC day (budget 50)', DAY_ONE);
    recordPatrolActions('checkDeadEndAgents', 51, DAY_ONE);

    const rows = listPatrolBudgetRows(DAY_ONE);
    const byName = new Map(rows.map((row) => [row.patrol, row]));
    expect(byName.get('runStallSweeperPatrol')).toMatchObject({ actions: 60, budget: 'exempt', suspended: false });
    expect(byName.get('checkDeadEndAgents')).toMatchObject({ actions: 51, budget: 50, suspended: true });
  });

  it('the state file lives under the deacon state dir', () => {
    expect(patrolBudgetFilePath()).toBe(join(home, 'deacon', 'patrol-budget.json'));
  });
});
