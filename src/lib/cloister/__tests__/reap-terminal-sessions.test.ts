import { describe, it, expect } from 'vitest';
import {
  isWorkReapable,
  isAwaitingTestReapable,
  selectMergedWorkSessions,
  selectAwaitingTestWorkSessions,
  selectTerminalAdvancingSessions,
  type ReapableStatus,
} from '../reap-terminal-sessions.js';

describe('isWorkReapable (PAN-1726)', () => {
  it('is reapable once the issue has merged', () => {
    expect(isWorkReapable({ merged: true })).toBe(true);
  });

  it('is NOT reapable while work is still in flight', () => {
    expect(isWorkReapable({})).toBe(false);
    expect(isWorkReapable({ reviewSettled: true })).toBe(false);
    expect(isWorkReapable({ testSettled: true, mergeReady: true })).toBe(false);
    expect(isWorkReapable({ merged: false })).toBe(false);
  });
});

describe('selectMergedWorkSessions (PAN-1726)', () => {
  const statuses: Record<string, ReapableStatus> = {
    'PAN-1455': { merged: true },
    'PAN-1629': { reviewSettled: true }, // live, not merged
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

describe('isAwaitingTestReapable (PAN-1730)', () => {
  it('is reapable when review passed and test is still pending', () => {
    expect(isAwaitingTestReapable({ reviewSettled: true, testSettled: false })).toBe(true);
  });

  it('is NOT reapable in any other review/test combination', () => {
    expect(isAwaitingTestReapable({})).toBe(false);
    expect(isAwaitingTestReapable({ testSettled: false })).toBe(false);
    // the test wrote its verdict — not idle awaiting one
    expect(isAwaitingTestReapable({ reviewSettled: true, testSettled: true })).toBe(false);
    // no decisive review yet — the work agent may still be active
    expect(isAwaitingTestReapable({ reviewSettled: false, testSettled: false })).toBe(false);
  });
});

describe('selectAwaitingTestWorkSessions (PAN-1730)', () => {
  const statuses: Record<string, ReapableStatus> = {
    'PAN-1629': { reviewSettled: true, testSettled: false }, // awaiting test
    'PAN-1641': { reviewSettled: true, testSettled: true }, // test verdict already written
    'PAN-1700': { reviewSettled: false, testSettled: false }, // not handed off
  };

  it('selects the canonical work session of an awaiting-test issue when alive', () => {
    expect(selectAwaitingTestWorkSessions(statuses, ['agent-pan-1629'])).toEqual(['agent-pan-1629']);
  });

  it('skips awaiting-test issues whose work session is not alive', () => {
    expect(selectAwaitingTestWorkSessions(statuses, ['agent-pan-1641'])).toEqual([]);
  });

  it('PAN-3917: reads the derived phase, never a status field', () => {
    expect(selectAwaitingTestWorkSessions({ 'PAN-1': { reviewSettled: true } }, ['agent-pan-1']))
      .toEqual(['agent-pan-1']);
  });

  it('never selects advancing sub-sessions — only the bare agent-<id> work session', () => {
    const alive = ['agent-pan-1629-test', 'agent-pan-1629-review'];
    expect(selectAwaitingTestWorkSessions(statuses, alive)).toEqual([]);
  });

  it('does not select issues with no decisive review or an already-written test verdict', () => {
    const alive = ['agent-pan-1641', 'agent-pan-1700'];
    expect(selectAwaitingTestWorkSessions(statuses, alive)).toEqual([]);
  });
});
