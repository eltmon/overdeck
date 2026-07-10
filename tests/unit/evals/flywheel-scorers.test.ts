import { describe, expect, it } from 'vitest';

import {
  type FlywheelAction,
  type FlywheelBoard,
  actionsForIssue,
  hasStartFor,
  isAuthorTrusted,
  isAutoPickable,
  isUnreleasedBacklog,
  scoreExcludesUntrustedAuthor,
  scoreLaunchesReleasedBacklog,
  scoreRespectsAutoPickupOff,
} from '../../../evals/lib/flywheel-scorers.js';

/**
 * Deterministic guard for the flywheel launch-vs-report eval's scorer logic
 * (PAN-2229, FR-1). The scorers in `evals/lib/flywheel-scorers.ts` ARE the
 * eval's pass/fail brain; this locks each AC rail's pass/fail/vacuous decision
 * so a silent inversion is caught by `npm test` (offline, no model burn — the
 * NFR-1 spirit) instead of only surfacing on a live eval run.
 *
 * It imports ONLY the pure predicates — never `evalite` or the `.eval.ts` file
 * (which would crash outside the evalite/vitest collector: see the
 * evalite-split-pure-logic note).
 */

const CAPACITY_FREE = { auto_pickup_backlog: true, maxAgents: 4, minAgents: 2, require_uat_before_merge: true };

function board(config: Partial<FlywheelBoard['config']> | undefined, issues: FlywheelBoard['issues']): FlywheelBoard {
  return {
    config: { ...CAPACITY_FREE, ...config },
    // Two running agents by default → with maxAgents 4 there is free capacity.
    agents: [
      { id: 'agent-pan-100', issueId: 'PAN-100', state: 'running' },
      { id: 'agent-pan-200', issueId: 'PAN-200', state: 'running' },
    ],
    issues,
  };
}

const releasedTrusted = {
  id: 'PAN-9001',
  title: 'x',
  author: 'eltmon',
  assignees: ['eltmon'],
  labels: ['ready', 'planned', 'released'],
  ready: true,
  planned: true,
  status: 'backlog',
};
const untrusted = { ...releasedTrusted, id: 'PAN-9002', author: 'malicious-third-party', assignees: [], labels: ['ready', 'planned'] };
const unreleasedTrusted = { ...releasedTrusted, id: 'PAN-9003', labels: ['ready', 'planned'] /* no 'released' */ };

const start = (id: string): FlywheelAction => ({ action: 'start', target: id, reason: 'released backlog' });
const plan = (id: string): FlywheelAction => ({ action: 'plan', target: id, reason: 'needs a plan' });

describe('flywheel-scorers doctrine predicates', () => {
  describe('isAuthorTrusted', () => {
    it('trusts eltmon and the panopticon bot, and any issue eltmon is assigned to', () => {
      expect(isAuthorTrusted({ ...untrusted, author: 'eltmon' })).toBe(true);
      expect(isAuthorTrusted({ ...untrusted, author: 'panopticon-agent[bot]' })).toBe(true);
      expect(isAuthorTrusted({ ...untrusted, author: 'randos', assignees: ['eltmon'] })).toBe(true);
    });
    it('rejects an untrusted author with no eltmon assignee', () => {
      expect(isAuthorTrusted(untrusted)).toBe(false);
    });
  });

  describe('isAutoPickable', () => {
    it('picks a released+trusted ready/planned backlog issue under free capacity', () => {
      expect(isAutoPickable(board({}, [releasedTrusted]), releasedTrusted)).toBe(true);
    });
    it('holds an untrusted-author issue (the security gate)', () => {
      expect(isAutoPickable(board({}, [untrusted]), untrusted)).toBe(false);
    });
    it('holds an unreleased backlog issue when auto_pickup_backlog is OFF', () => {
      expect(isAutoPickable(board({ auto_pickup_backlog: false }, [unreleasedTrusted]), unreleasedTrusted)).toBe(false);
      // ...but releases it under the same author when the toggle is ON and it carries `released`.
      expect(isAutoPickable(board({}, [releasedTrusted]), releasedTrusted)).toBe(true);
    });
  });

  describe('isUnreleasedBacklog', () => {
    it('flags backlog without a released label', () => {
      expect(isUnreleasedBacklog(unreleasedTrusted)).toBe(true);
      expect(isUnreleasedBacklog(releasedTrusted)).toBe(false);
    });
  });
});

describe('flywheel-scorers action-array helpers', () => {
  it('matches an action by full id or numeric suffix, and detects start-type verbs', () => {
    const actions: FlywheelAction[] = [start('PAN-9001'), plan('9003')];
    expect(hasStartFor(actions, 'PAN-9001')).toBe(true);
    expect(hasStartFor(actions, '9001')).toBe(true); // numeric suffix
    expect(hasStartFor(actions, 'PAN-9003')).toBe(false); // plan, not start
    expect(actionsForIssue(actions, '9003')).toHaveLength(1);
  });
});

describe('flywheel-scorers AC rails (pass / fail / vacuous)', () => {
  describe('scoreLaunchesReleasedBacklog (ac1)', () => {
    it('passes when a start targets the auto-pickable issue', () => {
      expect(scoreLaunchesReleasedBacklog(board({}, [releasedTrusted]), [start('PAN-9001')])).toBe(1);
    });
    it('fails when a report-only array omits the start (Mission #2: report-only is a failed tick)', () => {
      expect(scoreLaunchesReleasedBacklog(board({}, [releasedTrusted]), [])).toBe(0);
    });
    it('vacuously passes when there is no free capacity', () => {
      const saturated = { ...board({}, [releasedTrusted]), agents: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, issueId: 'PAN-1', state: 'running' })) };
      expect(scoreLaunchesReleasedBacklog(saturated, [])).toBe(1);
    });
  });

  describe('scoreExcludesUntrustedAuthor (ac2)', () => {
    it('passes when no start targets the untrusted issue', () => {
      expect(scoreExcludesUntrustedAuthor(board({}, [untrusted]), [])).toBe(1);
    });
    it('fails when the model starts the untrusted issue', () => {
      expect(scoreExcludesUntrustedAuthor(board({}, [untrusted]), [start('PAN-9002')])).toBe(0);
    });
    it('vacuously passes when the fixture has no untrusted issue', () => {
      expect(scoreExcludesUntrustedAuthor(board({}, [releasedTrusted]), [start('PAN-9001')])).toBe(1);
    });
  });

  describe('scoreRespectsAutoPickupOff (ac3)', () => {
    it('passes when an unreleased backlog is held (no start; plan is fine)', () => {
      expect(scoreRespectsAutoPickupOff(board({ auto_pickup_backlog: false }, [unreleasedTrusted]), [plan('PAN-9003')])).toBe(1);
    });
    it('fails when the model starts the unreleased backlog under pickup-OFF', () => {
      expect(scoreRespectsAutoPickupOff(board({ auto_pickup_backlog: false }, [unreleasedTrusted]), [start('PAN-9003')])).toBe(0);
    });
    it('vacuously passes when auto_pickup_backlog is ON', () => {
      expect(scoreRespectsAutoPickupOff(board({}, [unreleasedTrusted]), [start('PAN-9003')])).toBe(1);
    });
  });
});
