import { describe, expect, it } from 'vitest';

import {
  classifyAdvancingSessionLifecycle,
  isAdvancingLifecycleReclaimable,
  isRoleTerminal,
} from '../../cloister/review-status-source.js';
import { selectMergedAdvancingSessions } from '../../cloister/reap-terminal-sessions.js';
import { classifyAgentHealth } from '../health.js';

describe('advancing session lifecycle', () => {
  it.each([
    [{ reviewStatus: 'reviewing' }, true, 'active'],
    [{ reviewStatus: 'passed' }, true, 'warm'],
    [{ reviewStatus: 'passed', mergeStatus: 'merged' }, true, 'orphaned'],
    [undefined, true, 'unknown'],
    [{ reviewStatus: 'reviewing' }, false, 'unknown'],
  ] as const)(
    'classifies status %j with tmuxActive=%s as %s',
    (status, tmuxActive, expected) => {
      expect(classifyAdvancingSessionLifecycle('review', status, tmuxActive))
        .toBe(expected);
    },
  );

  it('uses the shared terminal-role predicate for warm sessions', () => {
    const status = { reviewStatus: 'passed' };

    expect(isRoleTerminal('review', status)).toBe(true);
    expect(classifyAdvancingSessionLifecycle('review', status, true)).toBe('warm');
  });

  it('uses the shared merged lifecycle for the advancing-session reaper', () => {
    const status = { reviewStatus: 'passed', mergeStatus: 'merged' };

    expect(classifyAdvancingSessionLifecycle('review', status, true)).toBe('orphaned');
    expect(selectMergedAdvancingSessions(
      { 'PAN-2647': status },
      ['agent-pan-2647-review'],
    )).toEqual(['agent-pan-2647-review']);
  });

  it.each([
    ['active', false],
    ['warm', false],
    ['orphaned', true],
    ['unknown', false],
  ] as const)('makes only %s lifecycle reclaimable when expected=%s', (lifecycle, expected) => {
    expect(isAdvancingLifecycleReclaimable(lifecycle)).toBe(expected);
  });

  it('does not infer an orphan from missing parent work-agent evidence', () => {
    expect(classifyAdvancingSessionLifecycle(
      'review',
      { reviewStatus: 'reviewing' },
      true,
    )).toBe('active');
  });

  it('preserves a live merged session as orphaned idle health', () => {
    const lifecycle = classifyAdvancingSessionLifecycle(
      'review',
      { reviewStatus: 'passed', mergeStatus: 'merged' },
      true,
    );
    const snapshot = classifyAgentHealth({
      agentId: 'agent-pan-2647-review',
      persisted: {
        status: 'available',
        value: {
          issueId: 'PAN-2647',
          role: 'review',
          status: 'running',
          startedAt: '2026-07-16T10:00:00.000Z',
          lastActivity: '2026-07-16T10:30:00.000Z',
        },
      },
      runtime: {
        state: 'active',
        lastActivity: '2026-07-16T10:30:00.000Z',
      },
      liveSessions: new Set(['agent-pan-2647-review']),
      reviewLifecycle: lifecycle,
      nowMs: Date.parse('2026-07-16T12:00:00.000Z'),
    });

    expect(snapshot).toMatchObject({
      status: 'idle',
      lifecycle: 'orphaned',
      tmuxActive: true,
    });
  });
});
