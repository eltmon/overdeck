import { describe, expect, it } from 'vitest';
import type { DashboardState } from '../../../lib/store';
import { createActivityEntryFeedSelector } from '../useActivityEntryFeed';

type ActivityRow = { id: string; timestamp: string; source: string; level: string; message: string; details: null; issueId: string | null };

function row(id: string, minute: number, issueId: string | null, message = `step ${id}`): ActivityRow {
  return {
    id,
    timestamp: `2026-09-28T10:${String(minute).padStart(2, '0')}:00.000Z`,
    source: 'work',
    level: 'info',
    message,
    details: null,
    issueId,
  };
}

function state(rows: ActivityRow[]): Pick<DashboardState, 'recentActivity'> {
  return { recentActivity: rows as unknown as DashboardState['recentActivity'] };
}

describe('createActivityEntryFeedSelector — PAN-4301 FR-14 per-issue collapse', () => {
  it('collapses each issue to its newest entry with a step count', () => {
    const select = createActivityEntryFeedSelector();

    const entries = select(state([
      row('a', 1, 'PAN-1', 'Work agent started'),
      row('b', 2, 'PAN-2', 'Review role spawned'),
      row('c', 3, 'PAN-1', 'Work agent committed task-1'),
      row('d', 4, 'PAN-1', 'Work agent committed task-2'),
    ]));

    expect(entries.map((entry) => [entry.issueId, entry.headline, entry.stepCount])).toEqual([
      ['PAN-1', 'Work agent committed task-2', 3],
      ['PAN-2', 'Review role spawned', 1],
    ]);
  });

  it('collapses issue ids case-insensitively', () => {
    const select = createActivityEntryFeedSelector();

    const entries = select(state([row('a', 1, 'pan-1'), row('b', 2, 'PAN-1')]));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'b', stepCount: 2 });
  });

  it('keeps every entry without an issue', () => {
    const select = createActivityEntryFeedSelector();

    const entries = select(state([row('a', 1, null), row('b', 2, null), row('c', 3, null)]));

    expect(entries.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('returns the same result instance for the same recentActivity reference', () => {
    const select = createActivityEntryFeedSelector();
    const input = state([row('a', 1, 'PAN-1'), row('b', 2, 'PAN-1')]);

    expect(select(input)).toBe(select({ recentActivity: input.recentActivity }));
  });
});
