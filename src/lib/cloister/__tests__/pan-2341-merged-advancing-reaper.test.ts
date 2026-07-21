import { describe, expect, it } from 'vitest';
import { canDispatchAdvancing } from '../concurrency.js';
import {
  selectMergedAdvancingSessions,
  type ReapableStatus,
} from '../reap-terminal-sessions.js';

function mergedStatus(): ReapableStatus {
  return {
    reviewStatus: 'passed',
    testStatus: 'passed',
    mergeStatus: 'merged',
    readyForMerge: false,
  };
}

describe('PAN-2341 merged advancing reaper', () => {
  it('selects merged advancing sessions so stopped rows can free the advancing ceiling', () => {
    const statuses: Record<string, ReapableStatus> = {};
    const alive: string[] = [];

    for (let i = 1; i <= 9; i += 1) {
      const issueId = `PAN-${3000 + i}`;
      statuses[issueId] = mergedStatus();
      alive.push(`agent-${issueId.toLowerCase()}-review`);
    }

    const selected = selectMergedAdvancingSessions(statuses, alive);

    expect(selected).toHaveLength(9);
    expect(selected).toEqual(expect.arrayContaining(alive));
    expect(canDispatchAdvancing({ work: 0, advancing: 0, swarm: 0, total: 0 })).toBe(true);
  });

  it('does not select advancing sessions for non-merged issues', () => {
    expect(selectMergedAdvancingSessions({
      'PAN-3001': { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'pending' },
    }, ['agent-pan-3001-review'])).toEqual([]);
  });

  it('is idempotent when previously selected sessions are no longer alive', () => {
    const statuses = { 'PAN-3001': mergedStatus() };
    const first = selectMergedAdvancingSessions(statuses, ['agent-pan-3001-review']);
    const second = selectMergedAdvancingSessions(statuses, []);

    expect(first).toEqual(['agent-pan-3001-review']);
    expect(second).toEqual([]);
  });

  it('selects merged advancing sessions under the warm lifecycle (merged = past close-out)', () => {
    expect(selectMergedAdvancingSessions({
      'PAN-3001': mergedStatus(),
    }, ['agent-pan-3001-test'])).toEqual(['agent-pan-3001-test']);
  });
});
