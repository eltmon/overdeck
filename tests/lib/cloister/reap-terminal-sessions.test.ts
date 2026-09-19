import { describe, expect, it } from 'vitest';

import {
  isRoleTerminal,
  sessionsToReapForRole,
  selectTerminalAdvancingSessions,
  type ReapableStatus,
} from '../../../src/lib/cloister/reap-terminal-sessions.js';

// PAN-3917: phases are derived from the forge (review approval/changes-requested,
// PR merged/mergeable) and the test role's verdict artifact — never a stored
// reviewStatus/testStatus/readyForMerge/mergeStatus field.
describe('reap-terminal-sessions — isRoleTerminal', () => {
  it('treats a settled review (approved or changes-requested) as terminal, an unsettled one as live', () => {
    expect(isRoleTerminal('review', { reviewSettled: true })).toBe(true);
    expect(isRoleTerminal('review', { reviewSettled: false })).toBe(false);
    expect(isRoleTerminal('review', {})).toBe(false);
  });

  it('treats a written test verdict as terminal, no verdict as live', () => {
    expect(isRoleTerminal('test', { testSettled: true })).toBe(true);
    expect(isRoleTerminal('test', { testSettled: false })).toBe(false);
    expect(isRoleTerminal('test', {})).toBe(false);
  });

  it('treats ship as terminal once merge-ready or merged', () => {
    expect(isRoleTerminal('ship', { mergeReady: true })).toBe(true);
    expect(isRoleTerminal('ship', { merged: true })).toBe(true);
    expect(isRoleTerminal('ship', { mergeReady: false, merged: false })).toBe(false);
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
      // review settled → reap review (+ convoy); test still live → keep test
      'PAN-1242': { reviewSettled: true, testSettled: false, mergeReady: false },
      // test verdict written → reap test
      'PAN-1642': { reviewSettled: true, testSettled: true },
      // review settled (changes requested) → reap review
      'PAN-1686': { reviewSettled: true, testSettled: false },
      // no decisive review yet → reap nothing
      'PAN-2000': { reviewSettled: false, testSettled: false },
    };
    const alive = [
      'agent-pan-1242-review',
      'agent-pan-1242-review-synthesis',
      'agent-pan-1242-test', // no verdict yet — must survive
      'agent-pan-1642-test',
      'agent-pan-1686-review',
      'agent-pan-2000-review', // review still open — must survive
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

  it('reaps a ship session once merge-ready, before merge lands', () => {
    const statuses: Record<string, ReapableStatus> = {
      'PAN-1500': { reviewSettled: true, testSettled: true, mergeReady: true, merged: false },
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
      'PAN-1242': { reviewSettled: true, testSettled: true, mergeReady: true },
    };
    expect(selectTerminalAdvancingSessions(statuses, [])).toEqual([]);
  });
});
