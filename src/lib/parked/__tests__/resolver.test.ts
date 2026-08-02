/**
 * Fixture tests for the parked-population classifier (PAN-3485 phase 1).
 * One test per orbit, plus the overlap rules (yield ≠ park, warm-idle ≠ park,
 * idle-running is the orbit of last resort) and population-level sort/dedup.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyParked,
  IDLE_RUNNING_THRESHOLD_MS,
  summarizeParked,
  type ParkedSignals,
} from '../resolver.js';
import type { ReviewStatus } from '../../review-status.js';
import type { AgentState } from '../../agents.js';

const NOW = Date.parse('2026-08-02T13:40:00.000Z');
const HOUR = 60 * 60_000;

function baseStatus(overrides: Partial<ReviewStatus>): ReviewStatus {
  return {
    issueId: 'PAN-1',
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    updatedAt: new Date(NOW - 2 * HOUR).toISOString(),
    readyForMerge: false,
    ...overrides,
  } as ReviewStatus;
}

function baseAgent(overrides: Partial<AgentState>): AgentState {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    role: 'work',
    status: 'running',
    workspace: '/tmp/ws',
    startedAt: new Date(NOW - 20 * HOUR).toISOString(),
    lastActivity: new Date(NOW - 20 * HOUR).toISOString(),
    ...overrides,
  } as AgentState;
}

function signals(overrides: Partial<ParkedSignals>): ParkedSignals {
  return {
    issueId: 'PAN-1',
    reviewStatus: null,
    agents: [],
    liveAgents: [],
    openRecoveryTrips: [],
    issueClosed: null,
    now: NOW,
    ...overrides,
  };
}

describe('classifyParked — one orbit at a time', () => {
  it('stuck-flag: review_status.stuck carries the machine reason through as copy', () => {
    const rows = classifyParked(signals({
      reviewStatus: baseStatus({ stuck: true, stuckReason: 'feedback_delivery_needs_you', stuckAt: new Date(NOW - 3 * HOUR).toISOString() }),
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].orbit).toBe('stuck-flag');
    expect(rows[0].parkedAt).toBe(new Date(NOW - 3 * HOUR).toISOString());
    expect(rows[0].parkReason).toContain('work agent is not running');
    expect(rows[0].details?.stuckReason).toBe('feedback_delivery_needs_you');
  });

  it('needs-you: an open recovery trip parks the issue', () => {
    const rows = classifyParked(signals({
      openRecoveryTrips: [{ recoveryPath: 'dead-end-rebuild', needsYouEmittedAt: new Date(NOW - 5 * HOUR).toISOString() }],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].orbit).toBe('needs-you');
    expect(rows[0].parkReason).toContain('dead-end-rebuild');
  });

  it('deacon-ignored: the ignore flag parks with its reason', () => {
    const rows = classifyParked(signals({
      reviewStatus: baseStatus({ deaconIgnored: true, deaconIgnoredReason: 'operator freeze', deaconIgnoredAt: new Date(NOW - HOUR).toISOString() }),
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].orbit).toBe('deacon-ignored');
    expect(rows[0].parkReason).toContain('operator freeze');
  });

  it('operator-gate: manual pause parks; scheduler yield does NOT', () => {
    const paused = classifyParked(signals({
      agents: [baseAgent({ paused: true, pausedAt: new Date(NOW - 90_000).toISOString() })],
    }));
    expect(paused).toHaveLength(1);
    expect(paused[0].orbit).toBe('operator-gate');
    expect(paused[0].details?.gate).toBe('paused');

    const yielded = classifyParked(signals({
      agents: [baseAgent({ paused: true, yieldedByScheduler: true })],
    }));
    expect(yielded).toHaveLength(0);
  });

  it('operator-gate: troubled and stopped-by-user each park', () => {
    const troubled = classifyParked(signals({ agents: [baseAgent({ troubled: true, troubledAt: new Date(NOW - HOUR).toISOString() })] }));
    expect(troubled[0]?.details?.gate).toBe('troubled');
    const stopped = classifyParked(signals({ agents: [baseAgent({ stoppedByUser: true, status: 'stopped', stoppedAt: new Date(NOW - HOUR).toISOString() })] }));
    expect(stopped[0]?.details?.gate).toBe('stopped-by-user');
  });

  it('uat-failed: failed UAT with merge pending parks; merged or ready does not', () => {
    const parked = classifyParked(signals({ reviewStatus: baseStatus({ reviewStatus: 'passed', testStatus: 'passed', uatStatus: 'failed' }) }));
    expect(parked).toHaveLength(1);
    expect(parked[0].orbit).toBe('uat-failed');
    expect(parked[0].parkReason).toContain('UAT failed');

    expect(classifyParked(signals({ reviewStatus: baseStatus({ uatStatus: 'failed', mergeStatus: 'merged' }) }))).toHaveLength(0);
    expect(classifyParked(signals({ reviewStatus: baseStatus({ uatStatus: 'failed', readyForMerge: true }) }))).toHaveLength(0);
  });

  it('merge-failed: any failed merge with no retry in flight parks, with retry-count copy at the cap', () => {
    const rows = classifyParked(signals({ reviewStatus: baseStatus({ mergeStatus: 'failed', mergeRetryCount: 25 }) }));
    expect(rows).toHaveLength(1);
    expect(rows[0].orbit).toBe('merge-failed');
    expect(rows[0].parkReason).toContain('exhausted');
  });

  it('conflicts: a conflicts_since mark parks until resolution', () => {
    const rows = classifyParked(signals({
      reviewStatus: baseStatus({ conflictsSince: { sha: 'c8a911e6fa6a991c6a1d1fe23d27fc2499f880ae', detectedAt: new Date(NOW - 4 * HOUR).toISOString(), paths: ['src/a.ts'] } }),
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].orbit).toBe('conflicts');
    expect(rows[0].parkReason).toContain('c8a911e6fa');
  });

  it('zombie-session: a live agent on a merged issue parks; on an open issue does not', () => {
    const live = [{ ...baseAgent({}), tmuxActive: true }];
    const zombie = classifyParked(signals({ reviewStatus: baseStatus({ mergeStatus: 'merged' }), liveAgents: live }));
    expect(zombie).toHaveLength(1);
    expect(zombie[0].orbit).toBe('zombie-session');

    // A live agent on an open, actively-touched issue parks in NO orbit.
    const fresh = [{ ...baseAgent({ lastActivity: new Date(NOW - 5 * 60_000).toISOString() }), tmuxActive: true }];
    const notZombie = classifyParked(signals({ reviewStatus: baseStatus({}), liveAgents: fresh, issueClosed: false }));
    expect(notZombie).toHaveLength(0);
  });

  it('idle-running: live + idle beyond threshold + no pipeline owner parks', () => {
    const idleAgent = [{ ...baseAgent({ lastActivity: new Date(NOW - IDLE_RUNNING_THRESHOLD_MS - HOUR).toISOString() }), tmuxActive: true }];
    const rows = classifyParked(signals({ reviewStatus: baseStatus({}), liveAgents: idleAgent }));
    expect(rows).toHaveLength(1);
    expect(rows[0].orbit).toBe('idle-running');
  });

  it('idle-running is the orbit of last resort — another orbit suppresses it', () => {
    const idleAgent = [{ ...baseAgent({ lastActivity: new Date(NOW - IDLE_RUNNING_THRESHOLD_MS - HOUR).toISOString() }), tmuxActive: true }];
    const rows = classifyParked(signals({
      reviewStatus: baseStatus({ stuck: true, stuckReason: 'verification_stuck' }),
      liveAgents: idleAgent,
    }));
    expect(rows.map((r) => r.orbit)).toEqual(['stuck-flag']);
  });

  it('warm-idle on a pipeline-owned issue is NOT a park (PAN-2579)', () => {
    const idleAgent = [{ ...baseAgent({ lastActivity: new Date(NOW - IDLE_RUNNING_THRESHOLD_MS - HOUR).toISOString() }), tmuxActive: true }];
    // review in flight → the pipeline owns the next move; the agent SHOULD wait.
    const rows = classifyParked(signals({
      reviewStatus: baseStatus({ reviewStatus: 'reviewing' }),
      liveAgents: idleAgent,
    }));
    expect(rows).toHaveLength(0);
  });

  it('circuit-breaker: 25+ requeues parks permanently', () => {
    const rows = classifyParked(signals({ reviewStatus: baseStatus({ autoRequeueCount: 25 }) }));
    expect(rows).toHaveLength(1);
    expect(rows[0].orbit).toBe('circuit-breaker');
    expect(rows[0].parkReason).toContain('25/25');
  });

  it('multiple orbits stack on one issue (stuck + operator gate)', () => {
    const rows = classifyParked(signals({
      reviewStatus: baseStatus({ stuck: true, stuckReason: 'review_infrastructure_failure' }),
      agents: [baseAgent({ paused: true, pausedAt: new Date(NOW - HOUR).toISOString() })],
    }));
    expect(rows.map((r) => r.orbit).sort()).toEqual(['operator-gate', 'stuck-flag']);
  });
});

describe('summarizeParked', () => {
  it('counts by orbit and picks the most severe primary per issue', () => {
    const summary = summarizeParked([
      { issueId: 'PAN-1', orbit: 'operator-gate', parkedAt: '2026-08-02T00:00:00Z', parkReason: '', unparkCondition: '', lastActionAt: null, actionCount: 0 },
      { issueId: 'PAN-1', orbit: 'zombie-session', parkedAt: '2026-08-02T01:00:00Z', parkReason: '', unparkCondition: '', lastActionAt: null, actionCount: 0 },
      { issueId: 'PAN-2', orbit: 'stuck-flag', parkedAt: '2026-08-02T02:00:00Z', parkReason: '', unparkCondition: '', lastActionAt: null, actionCount: 0 },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.byOrbit).toEqual({ 'operator-gate': 1, 'zombie-session': 1, 'stuck-flag': 1 });
    expect(summary.primaryByIssue['PAN-1']).toBe('zombie-session');
    expect(summary.primaryByIssue['PAN-2']).toBe('stuck-flag');
  });
});
