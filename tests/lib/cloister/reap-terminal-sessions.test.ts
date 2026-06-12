import { describe, expect, it } from 'vitest';

import {
  isRoleTerminal,
  sessionsToReapForRole,
  selectTerminalAdvancingSessions,
  type ReapableStatus,
} from '../../../src/lib/cloister/reap-terminal-sessions.js';

describe('reap-terminal-sessions — isRoleTerminal', () => {
  it('treats review passed/failed/blocked as terminal, reviewing/pending as live', () => {
    expect(isRoleTerminal('review', { reviewStatus: 'passed' })).toBe(true);
    expect(isRoleTerminal('review', { reviewStatus: 'failed' })).toBe(true);
    expect(isRoleTerminal('review', { reviewStatus: 'blocked' })).toBe(true);
    expect(isRoleTerminal('review', { reviewStatus: 'reviewing' })).toBe(false);
    expect(isRoleTerminal('review', { reviewStatus: 'pending' })).toBe(false);
    expect(isRoleTerminal('review', {})).toBe(false);
  });

  it('treats test passed/failed as terminal, testing/pending as live', () => {
    expect(isRoleTerminal('test', { testStatus: 'passed' })).toBe(true);
    expect(isRoleTerminal('test', { testStatus: 'failed' })).toBe(true);
    expect(isRoleTerminal('test', { testStatus: 'testing' })).toBe(false);
    expect(isRoleTerminal('test', { testStatus: 'pending' })).toBe(false);
  });

  it('treats ship as terminal once pushed (readyForMerge) or merge resolved', () => {
    expect(isRoleTerminal('ship', { readyForMerge: true })).toBe(true);
    expect(isRoleTerminal('ship', { mergeStatus: 'merged' })).toBe(true);
    expect(isRoleTerminal('ship', { mergeStatus: 'failed' })).toBe(true);
    expect(isRoleTerminal('ship', { readyForMerge: false })).toBe(false);
    expect(isRoleTerminal('ship', { mergeStatus: 'merging' })).toBe(false);
    expect(isRoleTerminal('ship', {})).toBe(false);
  });
});

describe('reap-terminal-sessions — sessionsToReapForRole', () => {
  const alive = [
    'agent-pan-1242', // work agent — never matched
    'agent-pan-1242-review',
    'agent-pan-1242-review-correctness',
    'agent-pan-1242-review-synthesis',
    'agent-pan-1242-test',
    'agent-pan-1242-ship',
    'agent-pan-99-review', // a different issue
    'specialist-pan-pan-1242-review', // legacy format
  ];

  it('matches the main review session, convoy sub-sessions, and legacy — never the work agent', () => {
    expect(sessionsToReapForRole('PAN-1242', 'review', alive).sort()).toEqual([
      'agent-pan-1242-review',
      'agent-pan-1242-review-correctness',
      'agent-pan-1242-review-synthesis',
      'specialist-pan-pan-1242-review',
    ]);
    // The bare work-agent session must never be reaped by the review role.
    expect(sessionsToReapForRole('PAN-1242', 'review', alive)).not.toContain('agent-pan-1242');
  });

  it('matches only the exact test/ship session for the issue', () => {
    expect(sessionsToReapForRole('PAN-1242', 'test', alive)).toEqual(['agent-pan-1242-test']);
    expect(sessionsToReapForRole('PAN-1242', 'ship', alive)).toEqual(['agent-pan-1242-ship']);
  });

  it('does not leak across issues', () => {
    expect(sessionsToReapForRole('PAN-99', 'review', alive)).toEqual(['agent-pan-99-review']);
  });

  it('returns nothing when no matching session is alive', () => {
    expect(sessionsToReapForRole('PAN-1242', 'test', ['agent-pan-1242-review'])).toEqual([]);
  });
});

describe('reap-terminal-sessions — selectTerminalAdvancingSessions', () => {
  it('reaps every terminal advancing session and leaves live ones alone', () => {
    const statuses: Record<string, ReapableStatus> = {
      // review passed → reap review (+ convoy); test still live → keep test
      'PAN-1242': { reviewStatus: 'passed', testStatus: 'testing', readyForMerge: false },
      // test failed verdict recorded → reap test
      'PAN-1642': { reviewStatus: 'passed', testStatus: 'failed' },
      // review blocked → reap review
      'PAN-1686': { reviewStatus: 'blocked', testStatus: 'pending' },
      // mid-review → reap nothing
      'PAN-2000': { reviewStatus: 'reviewing', testStatus: 'pending' },
    };
    const alive = [
      'agent-pan-1242-review',
      'agent-pan-1242-review-synthesis',
      'agent-pan-1242-test', // testing — must survive
      'agent-pan-1642-test',
      'agent-pan-1686-review',
      'agent-pan-2000-review', // reviewing — must survive
    ];

    const toKill = selectTerminalAdvancingSessions(statuses, alive).sort();
    expect(toKill).toEqual([
      'agent-pan-1242-review',
      'agent-pan-1242-review-synthesis',
      'agent-pan-1642-test',
      'agent-pan-1686-review',
    ]);
    expect(toKill).not.toContain('agent-pan-1242-test');
    expect(toKill).not.toContain('agent-pan-2000-review');
  });

  it('reaps a ship session once readyForMerge is set, before merge runs', () => {
    const statuses: Record<string, ReapableStatus> = {
      'PAN-1500': { reviewStatus: 'passed', testStatus: 'passed', readyForMerge: true, mergeStatus: 'pending' },
    };
    const alive = ['agent-pan-1500-ship', 'agent-pan-1500-review', 'agent-pan-1500-test'];
    expect(selectTerminalAdvancingSessions(statuses, alive).sort()).toEqual([
      'agent-pan-1500-review',
      'agent-pan-1500-ship',
      'agent-pan-1500-test',
    ]);
  });

  it('is a no-op when terminal statuses have no alive sessions', () => {
    const statuses: Record<string, ReapableStatus> = {
      'PAN-1242': { reviewStatus: 'passed', testStatus: 'passed', readyForMerge: true },
    };
    expect(selectTerminalAdvancingSessions(statuses, [])).toEqual([]);
  });
});
