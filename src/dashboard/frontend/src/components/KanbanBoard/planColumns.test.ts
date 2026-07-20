/**
 * PAN-2908 · C-BOARD — column assembly tests.
 * The Done column collapses to the cycle's recent N with the uncapped list
 * kept for the "show all" expansion; every other column passes through.
 */
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../types';
import { buildBoardColumns, DONE_DISPLAY_LIMIT } from './planColumns';

function issue(id: string, state: string, when: string): Issue {
  return {
    id,
    identifier: id,
    title: id,
    status: state,
    state,
    priority: 3,
    labels: [],
    url: '',
    updatedAt: when,
  } as Issue;
}

describe('buildBoardColumns · Done collapse (C-BOARD)', () => {
  it('caps Done at the recent N, recency-sorted, with overflow metadata', () => {
    const dones = Array.from({ length: DONE_DISPLAY_LIMIT + 8 }, (_, i) =>
      issue(`PAN-${i + 1}`, 'done', `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
    );
    const columns = buildBoardColumns({ done: dones }, [], {});
    const done = columns.find((c) => c.key === 'done')!;
    expect(done.issues).toHaveLength(DONE_DISPLAY_LIMIT);
    // Most recent first.
    expect(done.issues[0]!.identifier).toBe(`PAN-${DONE_DISPLAY_LIMIT + 8}`);
    expect(done.issues.at(-1)!.identifier).toBe('PAN-9');
    expect(done.overflowCount).toBe(8);
    expect(done.fullIssues).toHaveLength(DONE_DISPLAY_LIMIT + 8);
  });

  it('leaves Done uncapped at or under the limit', () => {
    const dones = Array.from({ length: DONE_DISPLAY_LIMIT }, (_, i) =>
      issue(`PAN-${i + 1}`, 'done', '2026-07-01T00:00:00.000Z'),
    );
    const done = buildBoardColumns({ done: dones }, [], {}).find((c) => c.key === 'done')!;
    expect(done.issues).toHaveLength(DONE_DISPLAY_LIMIT);
    expect(done.overflowCount).toBeUndefined();
    expect(done.fullIssues).toBeUndefined();
  });

  it('never caps WIP columns', () => {
    const wip = Array.from({ length: 40 }, (_, i) => issue(`PAN-${i + 1}`, 'in_progress', '2026-07-01T00:00:00.000Z'));
    const work = buildBoardColumns({ in_progress: wip }, [], {}).find((c) => c.key === 'in_progress')!;
    expect(work.issues).toHaveLength(40);
    expect(work.overflowCount).toBeUndefined();
  });
});
