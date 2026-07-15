import { describe, expect, it } from 'vitest';
import {
  computeRedWindows,
  selectRerunCandidates,
  type WorkflowRun,
} from '../../../../src/lib/cloister/stale-check-classifier.js';

const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  databaseId: 1,
  workflowName: 'CI',
  createdAt: '2026-07-15T10:00:00Z',
  conclusion: 'FAILURE',
  status: 'completed',
  attempt: 1,
  ...overrides,
});

describe('computeRedWindows', () => {
  it('opens a window on failure and closes it at the next success', () => {
    const windows = computeRedWindows([
      run({ createdAt: '2026-07-15T10:00:00Z' }),
      run({ createdAt: '2026-07-15T11:00:00Z', conclusion: 'SUCCESS' }),
    ]);

    expect(windows.get('CI')).toEqual([{
      start: '2026-07-15T10:00:00Z',
      end: '2026-07-15T11:00:00Z',
    }]);
  });

  it('leaves a trailing failure window open', () => {
    expect(computeRedWindows([run()]).get('CI')).toEqual([{
      start: '2026-07-15T10:00:00Z',
      end: null,
    }]);
  });

  it('sorts runs, keeps workflows independent, and returns multiple windows', () => {
    const windows = computeRedWindows([
      run({ workflowName: 'Lint', createdAt: '2026-07-15T12:00:00Z' }),
      run({ createdAt: '2026-07-15T14:00:00Z', conclusion: 'SUCCESS' }),
      run({ createdAt: '2026-07-15T13:00:00Z' }),
      run({ createdAt: '2026-07-15T11:00:00Z', conclusion: 'SUCCESS' }),
      run({ createdAt: '2026-07-15T10:00:00Z' }),
    ]);

    expect(windows.get('CI')).toEqual([
      { start: '2026-07-15T10:00:00Z', end: '2026-07-15T11:00:00Z' },
      { start: '2026-07-15T13:00:00Z', end: '2026-07-15T14:00:00Z' },
    ]);
    expect(windows.get('Lint')).toEqual([
      { start: '2026-07-15T12:00:00Z', end: null },
    ]);
  });

  it('ignores queued and in-progress runs', () => {
    expect(computeRedWindows([
      run({ status: 'queued' }),
      run({ status: 'in_progress', conclusion: 'SUCCESS' }),
    ])).toEqual(new Map());
  });

  it('recognizes every conclusion from the canonical failing set', () => {
    const conclusions = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'];
    const runs = conclusions.flatMap((conclusion, index) => [
      run({ workflowName: conclusion, conclusion, createdAt: `2026-07-15T10:0${index}:00Z` }),
      run({ workflowName: conclusion, conclusion: 'SUCCESS', createdAt: `2026-07-15T11:0${index}:00Z` }),
    ]);

    expect([...computeRedWindows(runs).keys()]).toEqual(conclusions);
  });
});

describe('selectRerunCandidates', () => {
  const closedAndOpenWindows = new Map([
    ['CI', [
      { start: '2026-07-15T10:00:00Z', end: '2026-07-15T11:00:00Z' },
      { start: '2026-07-15T13:00:00Z', end: null },
    ]],
  ]);

  it('selects a completed first-attempt failure inside a matching closed window', () => {
    const candidate = run({ createdAt: '2026-07-15T10:30:00Z' });

    expect(selectRerunCandidates([candidate], closedAndOpenWindows)).toEqual({
      rerun: [candidate],
      skipped: [],
    });
  });

  it('uses closed-window boundaries [start, end)', () => {
    const atStart = run({ databaseId: 1, createdAt: '2026-07-15T10:00:00Z' });
    const atEnd = run({ databaseId: 2, createdAt: '2026-07-15T11:00:00Z' });
    const result = selectRerunCandidates([atStart, atEnd], closedAndOpenWindows);

    expect(result.rerun).toEqual([atStart]);
    expect(result.skipped).toEqual([{ run: atEnd, reason: 'no-red-window-match' }]);
  });

  it.each([
    ['open main red window', run({ createdAt: '2026-07-15T13:30:00Z' }), 'main-still-red'],
    ['main-green interval', run({ createdAt: '2026-07-15T12:00:00Z' }), 'no-red-window-match'],
    ['run predating history', run({ createdAt: '2026-07-15T09:00:00Z' }), 'no-red-window-match'],
    ['workflow mismatch', run({ workflowName: 'Lint', createdAt: '2026-07-15T10:30:00Z' }), 'no-red-window-match'],
    ['second attempt', run({ createdAt: '2026-07-15T10:30:00Z', attempt: 2 }), 'attempt-exceeded'],
    ['in-progress run', run({ createdAt: '2026-07-15T10:30:00Z', status: 'in_progress' }), 'not-completed'],
  ] as const)('skips a %s with the specific reason', (_label, candidate, reason) => {
    expect(selectRerunCandidates([candidate], closedAndOpenWindows)).toEqual({
      rerun: [],
      skipped: [{ run: candidate, reason }],
    });
  });

  it('reports a missing attempt before evaluating red-window membership', () => {
    const candidate = run({ createdAt: '2026-07-15T10:30:00Z' });
    delete (candidate as Partial<WorkflowRun>).attempt;

    expect(selectRerunCandidates([candidate], closedAndOpenWindows)).toEqual({
      rerun: [],
      skipped: [{ run: candidate, reason: 'missing-attempt' }],
    });
  });

  it('does not select a non-failing completed run', () => {
    const candidate = run({ createdAt: '2026-07-15T10:30:00Z', conclusion: 'SUCCESS' });

    expect(selectRerunCandidates([candidate], closedAndOpenWindows)).toEqual({
      rerun: [],
      skipped: [{ run: candidate, reason: 'no-red-window-match' }],
    });
  });
});
