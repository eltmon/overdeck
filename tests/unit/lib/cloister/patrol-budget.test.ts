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
  listPatrolBudgetRows,
  patrolBudgetFilePath,
  readPatrolBudgetState,
  recordPatrolActions,
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
