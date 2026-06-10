import { describe, it, expect } from 'vitest';
import {
  isWorkReapable,
  selectMergedWorkSessions,
  selectTerminalAdvancingSessions,
  type ReapableStatus,
} from '../reap-terminal-sessions.js';

describe('isWorkReapable (PAN-1726)', () => {
  it('is reapable once the issue has merged', () => {
    expect(isWorkReapable({ mergeStatus: 'merged' })).toBe(true);
  });

  it('is NOT reapable while work is still in flight', () => {
    expect(isWorkReapable({})).toBe(false);
    expect(isWorkReapable({ reviewStatus: 'passed' })).toBe(false);
    expect(isWorkReapable({ testStatus: 'passed', readyForMerge: true })).toBe(false);
    expect(isWorkReapable({ mergeStatus: 'failed' })).toBe(false);
  });
});

describe('selectMergedWorkSessions (PAN-1726)', () => {
  const statuses: Record<string, ReapableStatus> = {
    'PAN-1455': { mergeStatus: 'merged' },
    'PAN-1629': { reviewStatus: 'passed' }, // live, not merged
  };

  it('reaps the canonical work session of a merged issue when alive', () => {
    expect(selectMergedWorkSessions(statuses, ['agent-pan-1455'])).toEqual(['agent-pan-1455']);
  });

  it('skips merged issues whose work session is not alive', () => {
    expect(selectMergedWorkSessions(statuses, ['agent-pan-1629'])).toEqual([]);
  });

  it('never reaps advancing sub-sessions — only the bare agent-<id> work session', () => {
    const alive = ['agent-pan-1455-review', 'agent-pan-1455-test', 'agent-pan-1455-inspect'];
    expect(selectMergedWorkSessions(statuses, alive)).toEqual([]);
  });

  it('does not reap the work session of a live (un-merged) issue', () => {
    expect(selectMergedWorkSessions(statuses, ['agent-pan-1629'])).toEqual([]);
  });

  it('is disjoint from the advancing reaper for the same merged issue', () => {
    const alive = ['agent-pan-1455', 'agent-pan-1455-review'];
    const work = selectMergedWorkSessions(statuses, alive);
    const advancing = selectTerminalAdvancingSessions(statuses, alive);
    expect(work).toEqual(['agent-pan-1455']);
    expect(advancing).not.toContain('agent-pan-1455');
  });
});
