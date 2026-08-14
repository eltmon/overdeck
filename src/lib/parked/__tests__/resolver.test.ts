/**
 * Fixture tests for the parked-population classifier (PAN-3485 phase 1).
 * One test per orbit, plus the overlap rules (yield ≠ park, warm-idle ≠ park,
 * idle-running is the orbit of last resort) and population-level sort/dedup.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gather = vi.hoisted(() => ({
  statuses: {} as Record<string, unknown>,
  agents: [] as unknown[],
  liveAgents: [] as unknown[],
}));
vi.mock('../../review-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../review-status.js')>();
  return { ...actual, loadReviewStatuses: () => gather.statuses };
});
vi.mock('../../agents/queries.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agents/queries.js')>();
  return { ...actual, listAgentStates: () => gather.agents, listRunningAgentsSync: () => gather.liveAgents };
});

const projects = vi.hoisted(() => ({
  registry: new Map<string, { projectKey: string; projectPath: string }>(),
}));
vi.mock('../../projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: vi.fn((issueId: string) => projects.registry.get(issueId.toUpperCase()) ?? null),
    getProjectSync: vi.fn((key: string) => {
      for (const value of projects.registry.values()) {
        if (value.projectKey === key) return { name: key, path: value.projectPath };
      }
      return null;
    }),
  };
});

import {
  classifyParked,
  defaultReadRecordTerminal,
  IDLE_RUNNING_THRESHOLD_MS,
  PARKED_ORBITS,
  resolveParkedPopulation,
  summarizeParked,
  type ParkedSignals,
} from '../resolver.js';
import type { ReviewStatus } from '../../review-status.js';
import type { AgentState } from '../../agents.js';
import type { ProjectConfig } from '../../projects.js';

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

  it('uat-failed: parks only when no live work agent owns the rework', () => {
    const parked = classifyParked(signals({ reviewStatus: baseStatus({ reviewStatus: 'passed', testStatus: 'passed', uatStatus: 'failed' }) }));
    expect(parked).toHaveLength(1);
    expect(parked[0].orbit).toBe('uat-failed');
    expect(parked[0].parkReason).toContain('UAT-failure relay found no delivery target');
    expect(parked[0].unparkCondition).toContain('pan start');

    const workAgent = [{ ...baseAgent({ role: 'work' }), tmuxActive: true }];
    expect(classifyParked(signals({
      reviewStatus: baseStatus({ reviewStatus: 'passed', testStatus: 'passed', uatStatus: 'failed' }),
      liveAgents: workAgent,
    })).find((row) => row.orbit === 'uat-failed')).toBeUndefined();
    expect(classifyParked(signals({ reviewStatus: baseStatus({ uatStatus: 'failed', mergeStatus: 'merged' }) }))).toHaveLength(0);
    expect(classifyParked(signals({ reviewStatus: baseStatus({ uatStatus: 'failed', readyForMerge: true }) }))).toHaveLength(0);
  });

  it('merge-failed: any failed merge with no retry in flight parks, with retry-count copy at the cap', () => {
    const rows = classifyParked(signals({ reviewStatus: baseStatus({ mergeStatus: 'failed', mergeRetryCount: 25 }) }));
    expect(rows).toHaveLength(1);
    expect(rows[0].orbit).toBe('merge-failed');
    expect(rows[0].parkReason).toContain('exhausted');
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
      { issueId: 'PAN-1', orbit: 'operator-gate', parkedAt: '2026-08-02T00:00:00Z', parkReason: '', unparkCondition: '' },
      { issueId: 'PAN-1', orbit: 'zombie-session', parkedAt: '2026-08-02T01:00:00Z', parkReason: '', unparkCondition: '' },
      { issueId: 'PAN-2', orbit: 'stuck-flag', parkedAt: '2026-08-02T02:00:00Z', parkReason: '', unparkCondition: '' },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.byOrbit).toEqual({ 'operator-gate': 1, 'zombie-session': 1, 'stuck-flag': 1 });
    expect(summary.primaryByIssue['PAN-1']).toBe('zombie-session');
    expect(summary.primaryByIssue['PAN-2']).toBe('stuck-flag');
  });
});

describe('guard-exit inventory (PAN-3488)', () => {
  it('every orbit in the taxonomy has a fixture producing non-empty park + release copy', () => {
    // One fixture per orbit — the taxonomy is nine entries and each must
    // classify with both sentences populated. A new orbit added to
    // PARKED_ORBITS without a classifier branch (or without copy) fails here.
    const fixtures: Record<string, ParkedSignals> = {
      'stuck-flag': signals({ reviewStatus: baseStatus({ stuck: true, stuckReason: 'verification_stuck' }) }),
      'needs-you': signals({ openRecoveryTrips: [{ recoveryPath: 'dead-end-rebuild' }] }),
      'deacon-ignored': signals({ reviewStatus: baseStatus({ deaconIgnored: true, deaconIgnoredReason: 'freeze' }) }),
      'operator-gate': signals({ agents: [baseAgent({ paused: true })] }),
      'uat-failed': signals({ reviewStatus: baseStatus({ reviewStatus: 'passed', testStatus: 'passed', uatStatus: 'failed' }) }),
      'merge-failed': signals({ reviewStatus: baseStatus({ mergeStatus: 'failed' }) }),
      'zombie-session': signals({ reviewStatus: baseStatus({ mergeStatus: 'merged' }), liveAgents: [{ ...baseAgent({}), tmuxActive: true }] }),
      'idle-running': signals({ reviewStatus: baseStatus({}), liveAgents: [{ ...baseAgent({ lastActivity: new Date(NOW - IDLE_RUNNING_THRESHOLD_MS - 60_000).toISOString() }), tmuxActive: true }] }),
      'circuit-breaker': signals({ reviewStatus: baseStatus({ autoRequeueCount: 30 }) }),
    };
    expect(Object.keys(fixtures).sort()).toEqual([...PARKED_ORBITS].sort());
    for (const orbit of PARKED_ORBITS) {
      const rows = classifyParked(fixtures[orbit]);
      const row = rows.find((candidate) => candidate.orbit === orbit);
      expect(row, `orbit ${orbit} must classify`).toBeDefined();
      expect(row!.parkReason.length, `orbit ${orbit} must say WHY it is parked`).toBeGreaterThan(0);
      expect(row!.unparkCondition.length, `orbit ${orbit} must document its exit`).toBeGreaterThan(0);
    }
  });
});

describe('orchestrator idle exemption (first-night flywheel kill)', () => {
  it('flywheel/sequencer/conversation agents never classify idle-running', () => {
    for (const role of ['flywheel', 'sequencer', 'conversation']) {
      const idleAgent = [{ ...baseAgent({ role, lastActivity: new Date(NOW - 26 * HOUR).toISOString() }), tmuxActive: true }];
      const rows = classifyParked(signals({ reviewStatus: baseStatus({}), liveAgents: idleAgent }));
      expect(rows, `role ${role} must never be idle-running`).toHaveLength(0);
    }
  });
});

describe('completed-handoff is not an operator park (pan done suppression)', () => {
  it('a stoppedByUser agent WITH a completed marker never reports operator-gate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-dir-'));
    mkdirSync(join(dir, 'agents', 'agent-pan-9'), { recursive: true });
    writeFileSync(join(dir, 'agents', 'agent-pan-9', 'completed'), '');
    process.env.OVERDECK_HOME = dir;
    const rows = classifyParked(signals({
      agents: [baseAgent({ id: 'agent-pan-9', stoppedByUser: true, status: 'stopped', stoppedAt: new Date(NOW - HOUR).toISOString() })],
    }));
    expect(rows).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('resolveParkedPopulation record-first terminality (PAN-3727)', () => {
  beforeEach(() => {
    gather.statuses = {};
    gather.agents = [];
    gather.liveAgents = [];
  });

  it('AC1: a record-terminal issue with an open trip and a stoppedByUser row produces zero rows without calling isClosed', async () => {
    gather.agents = [baseAgent({ id: 'agent-pan-500', issueId: 'PAN-500', status: 'stopped', stoppedByUser: true, stoppedAt: new Date(NOW - HOUR).toISOString() })];
    const isClosedSpy = vi.fn(async () => { throw new Error('isClosed must not be called for a record-terminal issue'); });

    const rows = await resolveParkedPopulation({
      now: NOW,
      readRecordTerminal: async (issueId) => issueId === 'PAN-500',
      readOpenTrips: async () => [{ recoveryPath: 'orphan-proposed-pickup-gate' }],
      isClosed: isClosedSpy,
    });

    expect(rows.filter((row) => row.issueId === 'PAN-500')).toHaveLength(0);
    expect(isClosedSpy).not.toHaveBeenCalled();
  });

  it('AC2: a record-terminal issue survives a tracker-blip isClosed=false with zero non-zombie rows', async () => {
    const live = baseAgent({ id: 'agent-pan-501', issueId: 'PAN-501', status: 'running', lastActivity: new Date(NOW - HOUR).toISOString() });
    gather.agents = [live];
    gather.liveAgents = [{ ...live, tmuxActive: true }];
    const isClosedSpy = vi.fn(async () => false);

    const rows = await resolveParkedPopulation({
      now: NOW,
      readRecordTerminal: async (issueId) => issueId === 'PAN-501',
      isClosed: isClosedSpy,
    });

    const nonZombie = rows.filter((row) => row.issueId === 'PAN-501' && row.orbit !== 'zombie-session');
    expect(nonZombie).toHaveLength(0);
    expect(isClosedSpy).not.toHaveBeenCalled();
    // The live session itself is still a reap candidate.
    expect(rows.some((row) => row.issueId === 'PAN-501' && row.orbit === 'zombie-session')).toBe(true);
  });

  it('AC3/AC4: a non-terminal record falls back to the tracker closed-check exactly as before', async () => {
    const live = baseAgent({ id: 'agent-pan-502', issueId: 'PAN-502', status: 'running', lastActivity: new Date(NOW - HOUR).toISOString() });
    gather.agents = [live];
    gather.liveAgents = [{ ...live, tmuxActive: true }];
    const isClosedSpy = vi.fn(async () => false);

    const rows = await resolveParkedPopulation({
      now: NOW,
      readRecordTerminal: async () => false,
      isClosed: isClosedSpy,
    });

    expect(isClosedSpy).toHaveBeenCalledWith('PAN-502');
    // Not record-terminal and tracker says open — the issue classifies normally
    // (no zombie-session row for a live agent on an open issue).
    expect(rows.some((row) => row.issueId === 'PAN-502' && row.orbit === 'zombie-session')).toBe(false);
  });
});

describe('defaultReadRecordTerminal (PAN-3727)', () => {
  let root: string;
  const ISSUE = 'RECTERM-1';

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  }

  function seedRecord(pipeline: Record<string, unknown>): void {
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'recterm-1.json'), JSON.stringify({
      issueId: ISSUE,
      schemaVersion: 2,
      pipeline: { issueId: ISSUE, reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: new Date().toISOString(), ...pipeline },
    }));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-recterm-'));
    git('init', '-q');
    git('config', 'user.email', 'test@overdeck.local');
    git('config', 'user.name', 'Overdeck Test');
    projects.registry.set(ISSUE, { projectKey: 'fixture-recterm', projectPath: root });
  });

  afterEach(() => {
    projects.registry.clear();
    rmSync(root, { recursive: true, force: true });
  });

  it('closedOut=true is terminal', async () => {
    seedRecord({ closedOut: true, closedOutAt: '2026-08-06T00:00:00.000Z' });
    expect(await defaultReadRecordTerminal(ISSUE)).toBe(true);
  });

  it('mergeStatus=merged with no reopenedAt is terminal', async () => {
    seedRecord({ mergeStatus: 'merged' });
    expect(await defaultReadRecordTerminal(ISSUE)).toBe(true);
  });

  it('AC3 boundary: mergeStatus=merged WITH reopenedAt set is NOT terminal', async () => {
    seedRecord({ mergeStatus: 'merged', reopenedAt: '2026-08-10T00:00:00.000Z' });
    expect(await defaultReadRecordTerminal(ISSUE)).toBe(false);
  });

  it('AC4: no terminal evidence (open issue) is NOT terminal', async () => {
    seedRecord({});
    expect(await defaultReadRecordTerminal(ISSUE)).toBe(false);
  });

  it('an unresolvable issue id is NOT terminal', async () => {
    expect(await defaultReadRecordTerminal('NO-SUCH-PROJECT-1')).toBe(false);
  });
});
