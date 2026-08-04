/**
 * Fixture tests for the stall sweeper patrol (PAN-3485 phase 2).
 * Proves each orbit takes its documented action, operator gates are never
 * overridden, cooldowns bind, exhaustion escalates, and the scan event fires
 * only on population change.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = Date.parse('2026-08-02T14:00:00.000Z');
const HOUR = 60 * 60_000;

// getOverdeckHome() reads process.env.OVERDECK_HOME at call time — point it at
// a per-test temp dir instead of mocking paths.js (vi.mock factories hoist
// above module-scope initializers and TDZ-crash the import chain).
let home: string;
let savedHome: string | undefined;

// getAgentStateSync drives the redrive gate — controlled per test.
const agentStateByAgentId = new Map<string, Record<string, unknown>>();
vi.mock('../../agents.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../agents.js')>();
  return {
    ...original,
    getAgentStateSync: (id: string) => agentStateByAgentId.get(id) ?? null,
  };
});

import {
  runStallSweeperPatrol,
  SWEEP_MAX_ACTIONS_PER_ROW,
  SWEEP_RESURFACE_TTL_MS,
  type StallSweeperDeps,
} from '../stall-sweeper.js';
import { readSweeperRowState, writeSweeperRowState, writeSweeperSignature } from '../stall-sweeper-state.js';
import type { ParkedRow } from '../../parked/resolver.js';
import type { SynthesisArtifactVerdict } from '../synthesis-verdict.js';
import type { ArtifactVerdictRestoreResult } from '../verdict-restore.js';

function parkedRow(overrides: Partial<ParkedRow>): ParkedRow {
  return {
    issueId: 'PAN-1',
    orbit: 'stuck-flag',
    parkedAt: new Date(NOW - 5 * HOUR).toISOString(),
    parkReason: 'test park reason',
    unparkCondition: 'test release condition',
    lastActionAt: null,
    actionCount: 0,
    ...overrides,
  };
}

interface Harness {
  deps: StallSweeperDeps;
  calls: {
    spawn: string[];
    stop: string[];
    message: string[];
    feedback: string[];
    review: string[];
    clearStuck: string[];
    resetMerge: string[];
    feedbackBodies: string[];
    restore: string[];
    restoreArtifacts: SynthesisArtifactVerdict[];
    events: { type: string; payload: Record<string, unknown> }[];
    activity: { level: string; issueId?: string; message: string }[];
  };
}

function harness(
  rows: ParkedRow[],
  opts: {
    liveAgents?: string[];
    /** PAN-3511: the verdict of record the sweeper will find, if any. */
    artifact?: SynthesisArtifactVerdict | null;
    restoreOutcome?: ArtifactVerdictRestoreResult['outcome'];
  } = {},
): Harness {
  const calls: Harness['calls'] = {
    spawn: [], stop: [], message: [], feedback: [], review: [], clearStuck: [], resetMerge: [], events: [], activity: [],
    feedbackBodies: [], restore: [], restoreArtifacts: [],
  };
  const live = new Set(opts.liveAgents ?? []);
  const artifact = opts.artifact ?? null;
  const deps: StallSweeperDeps = {
    now: NOW,
    resolveRows: async () => rows,
    spawnWorkAgent: async (issueId) => { calls.spawn.push(issueId); return { spawned: true }; },
    stopAgent: async (agentId) => { calls.stop.push(agentId); },
    messageAgent: async (agentId, text) => { calls.message.push(`${agentId}::${text}`); return { delivered: true, queuedToMail: false }; },
    writeFeedback: async (issueId, stage, summary, markdownBody) => {
      calls.feedback.push(`${issueId}::${stage}::${summary}`);
      calls.feedbackBodies.push(markdownBody);
    },
    dispatchReview: async (issueId) => { calls.review.push(issueId); },
    clearStuck: (issueId) => { calls.clearStuck.push(issueId); },
    resetMergeForEvaluation: (issueId) => { calls.resetMerge.push(issueId); },
    isAgentLive: (agentId) => live.has(agentId),
    emitActivity: (entry) => { calls.activity.push(entry); },
    emitEvent: (type, payload) => { calls.events.push({ type, payload }); },
    readArtifact: () => artifact,
    restoreVerdict: async (issueId, selectedArtifact) => {
      calls.restore.push(issueId);
      calls.restoreArtifacts.push(selectedArtifact);
      const outcome = opts.restoreOutcome ?? 'restored';
      if (outcome === 'no-artifact') return { outcome: 'no-artifact' };
      return { outcome, artifact: selectedArtifact };
    },
  };
  return { deps, calls };
}

beforeEach(() => {
  savedHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'sweeper-test-'));
  process.env.OVERDECK_HOME = home;
  agentStateByAgentId.clear();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe('runStallSweeperPatrol — per-orbit actions', () => {
  it('zombie-session: stops the agent and emits sweep.unparked', async () => {
    const { deps, calls } = harness([parkedRow({ orbit: 'zombie-session', details: { agentId: 'strike-pan-1' } })]);
    const actions = await runStallSweeperPatrol(deps);
    expect(calls.stop).toEqual(['strike-pan-1']);
    expect(calls.events.some((e) => e.type === 'sweep.unparked' && e.payload['issueId'] === 'PAN-1')).toBe(true);
    expect(actions.some((a) => a.includes('reaped zombie'))).toBe(true);
  });

  it('merge-failed: resets merge for re-evaluation, bounded by cooldown', async () => {
    const row = parkedRow({ orbit: 'merge-failed' });
    const { deps, calls } = harness([row]);
    await runStallSweeperPatrol(deps);
    expect(calls.resetMerge).toEqual(['PAN-1']);
    // Second scan inside the cooldown window takes no action.
    const again = await runStallSweeperPatrol(deps);
    expect(calls.resetMerge).toEqual(['PAN-1']);
    expect(again).toHaveLength(0);
  });

  it('uat-failed: writes feedback and resumes the work agent', async () => {
    const { deps, calls } = harness([parkedRow({ orbit: 'uat-failed', details: { uatNotes: 'login flow broken' } })]);
    await runStallSweeperPatrol(deps);
    expect(calls.feedback[0]).toContain('PAN-1::uat');
    expect(calls.spawn).toEqual(['PAN-1']);
    expect(calls.events.some((e) => e.type === 'sweep.action' && e.payload['action'] === 'uat-redrive')).toBe(true);
  });

  it('stuck-flag review_infrastructure_failure: clears the flag and re-dispatches review', async () => {
    const { deps, calls } = harness([parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'review_infrastructure_failure' } })]);
    await runStallSweeperPatrol(deps);
    expect(calls.clearStuck).toEqual(['PAN-1']);
    expect(calls.review).toEqual(['PAN-1']);
    expect(calls.events.some((e) => e.type === 'sweep.unparked')).toBe(true);
  });

  it('stuck-flag feedback_delivery_needs_you: resumes with rework feedback and clears the flag', async () => {
    const { deps, calls } = harness([parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'feedback_delivery_needs_you' } })]);
    await runStallSweeperPatrol(deps);
    expect(calls.feedback[0]).toContain('PAN-1::rework');
    expect(calls.spawn).toEqual(['PAN-1']);
    expect(calls.clearStuck).toEqual(['PAN-1']);
  });

  // PAN-3511 — the verdict of record outranks the stuck flag.
  it.each([
    'review_infrastructure_failure',
    'feedback_delivery_needs_you',
    'verification_stuck',
  ])('stuck-flag %s + a fresh PASSED artifact: unparks silently, zero messages (ac1)', async (stuckReason) => {
    // A reviewer that already approved must never be re-driven. The consult runs
    // ahead of every branch, so no rework text reaches the agent and no fresh
    // review is dispatched over a verdict that already exists.
    const artifact = { verdict: 'passed', runId: 'agent-pan-1-review-run', mtimeMs: NOW - 60_000 } as const;
    const { deps, calls } = harness(
      [parkedRow({ orbit: 'stuck-flag', details: { stuckReason } })],
      { artifact, liveAgents: ['agent-pan-1'] },
    );
    const actions = await runStallSweeperPatrol(deps);

    expect(calls.message).toEqual([]);
    expect(calls.spawn).toEqual([]);
    expect(calls.review).toEqual([]);
    expect(calls.restoreArtifacts).toEqual([artifact]);
    expect(calls.clearStuck).toEqual(['PAN-1']);
    expect(calls.events.some((e) => e.type === 'sweep.unparked' && e.payload['action'] === 'verdict-restored')).toBe(true);
    expect(actions.some((a) => a.includes('fresh passed review artifact'))).toBe(true);
  });

  it('stuck-flag + a PASSED artifact the head guard blocks: stays parked, still zero messages (ac1)', async () => {
    // The restore door reports the mismatch itself; the sweeper must not treat a
    // failed restore as licence to re-drive a review that demonstrably finished.
    const { deps, calls } = harness(
      [parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'verification_stuck' } })],
      { artifact: { verdict: 'passed', headSha: 'aaaaaaa1', mtimeMs: NOW - 60_000 }, restoreOutcome: 'blocked-by-head-guard' },
    );
    await runStallSweeperPatrol(deps);

    expect(calls.message).toEqual([]);
    expect(calls.spawn).toEqual([]);
    expect(calls.clearStuck).toEqual([]);
    expect(calls.events.some((e) => e.type === 'sweep.unparked')).toBe(false);
  });

  it('stuck-flag + a fresh BLOCKED artifact: re-drives with the reviewer blocker, not a directory pointer (ac2)', async () => {
    const { deps, calls } = harness(
      [parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'feedback_delivery_needs_you' } })],
      { artifact: { verdict: 'blocked', notes: 'null deref in the parser', mtimeMs: NOW - 60_000 } },
    );
    await runStallSweeperPatrol(deps);

    expect(calls.spawn).toEqual(['PAN-1']);
    expect(calls.clearStuck).toEqual(['PAN-1']);
    expect(calls.feedbackBodies[0]).toContain('null deref in the parser');
    expect(calls.feedbackBodies[0]).not.toContain('Address the pending feedback in');
  });

  it('stuck-flag + NO artifact: the rework body keeps its pending-feedback pointer (ac3)', async () => {
    // The one-directional rule — an absent artifact changes nothing.
    const { deps, calls } = harness([parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'verification_stuck' } })]);
    await runStallSweeperPatrol(deps);

    expect(calls.restore).toEqual([]);
    expect(calls.spawn).toEqual(['PAN-1']);
    expect(calls.feedbackBodies[0]).toContain('Address the pending feedback in `.pan/feedback`');
  });

  it('conflicts: resumes the work agent with conflict-resolution feedback', async () => {
    const { deps, calls } = harness([parkedRow({ orbit: 'conflicts', details: { sha: 'abc', paths: [] } })]);
    await runStallSweeperPatrol(deps);
    expect(calls.feedback[0]).toContain('PAN-1::conflicts');
    expect(calls.spawn).toEqual(['PAN-1']);
  });

  it('idle-running: nudges first, then stops only when the agent never moves', async () => {
    const row = parkedRow({ orbit: 'idle-running', details: { agentId: 'agent-pan-1', idleMinutes: 420 } });
    agentStateByAgentId.set('agent-pan-1', { lastActivity: '2026-08-02T07:00:00.000Z' });
    const { deps, calls } = harness([row]);
    await runStallSweeperPatrol(deps);
    expect(calls.message).toHaveLength(1);
    expect(calls.message[0]).toContain('agent-pan-1');
    expect(calls.stop).toHaveLength(0);

    // Grace elapsed, activity stamp unchanged → stop.
    const state = readSweeperRowState('PAN-1', 'idle-running');
    expect(state?.nudgedActivityAt).toBe('2026-08-02T07:00:00.000Z');
    const laterDeps = { ...deps, now: NOW + 2 * HOUR };
    await runStallSweeperPatrol(laterDeps);
    expect(calls.stop).toEqual(['agent-pan-1']);
    expect(calls.events.some((e) => e.type === 'sweep.unparked' && e.payload['action'] === 'stopped-idle')).toBe(true);
  });

  it('idle-running: an agent that moved after the nudge is NOT stopped', async () => {
    const row = parkedRow({ orbit: 'idle-running', details: { agentId: 'agent-pan-1', idleMinutes: 60 } });
    agentStateByAgentId.set('agent-pan-1', { lastActivity: '2026-08-02T13:00:00.000Z' });
    const { deps, calls } = harness([row]);
    await runStallSweeperPatrol(deps);
    // Agent moved (new lastActivity) before the grace check.
    agentStateByAgentId.set('agent-pan-1', { lastActivity: '2026-08-02T13:30:00.000Z' });
    await runStallSweeperPatrol({ ...deps, now: NOW + 2 * HOUR });
    expect(calls.stop).toHaveLength(0);
  });
});

describe('runStallSweeperPatrol — gates, exhaustion, escalation', () => {
  it('operator-gate rows are NEVER acted on, only re-surfaced on TTL', async () => {
    const { deps, calls } = harness([parkedRow({ orbit: 'operator-gate' })]);
    await runStallSweeperPatrol(deps);
    expect(calls.spawn).toHaveLength(0);
    expect(calls.stop).toHaveLength(0);
    expect(calls.events.some((e) => e.type === 'sweep.escalated')).toBe(true);
    // Re-surfaced once — inside the TTL a second scan stays silent.
    await runStallSweeperPatrol({ ...deps, now: NOW + HOUR });
    expect(calls.events.filter((e) => e.type === 'sweep.escalated')).toHaveLength(1);
    // TTL elapsed → re-surfaces again (the anti-silence property).
    await runStallSweeperPatrol({ ...deps, now: NOW + SWEEP_RESURFACE_TTL_MS + HOUR });
    expect(calls.events.filter((e) => e.type === 'sweep.escalated')).toHaveLength(2);
  });

  it('a row that exhausted its action budget escalates instead of acting', async () => {
    writeSweeperRowState('PAN-1', 'merge-failed', {
      actionCount: SWEEP_MAX_ACTIONS_PER_ROW,
      lastActionAt: new Date(NOW - 3 * HOUR).toISOString(),
      episodeStartedAt: new Date(NOW - 30 * HOUR).toISOString(),
    });
    const { deps, calls } = harness([parkedRow({ orbit: 'merge-failed' })]);
    await runStallSweeperPatrol(deps);
    expect(calls.resetMerge).toHaveLength(0);
    expect(calls.events.some((e) => e.type === 'sweep.escalated' && String(e.payload['reason']).includes('exhausted'))).toBe(true);
  });

  it('re-drive deferred by the redrive gate records no action (operator stop wins)', async () => {
    agentStateByAgentId.set('agent-pan-1', { stoppedByUser: true, status: 'stopped' });
    const { deps, calls } = harness([parkedRow({ orbit: 'uat-failed', details: {} })]);
    const actions = await runStallSweeperPatrol(deps);
    expect(calls.spawn).toHaveLength(0);
    expect(calls.feedback).toHaveLength(0);
    expect(actions.some((a) => a.includes('deferred'))).toBe(true);
    expect(readSweeperRowState('PAN-1', 'uat-failed')?.actionCount ?? 0).toBe(0);
  });

  it('sweep.scan fires on population change only', async () => {
    const row = parkedRow({ orbit: 'operator-gate' });
    writeSweeperSignature('PAN-1:operator-gate');
    const { deps, calls } = harness([row]);
    await runStallSweeperPatrol(deps);
    expect(calls.events.some((e) => e.type === 'sweep.scan')).toBe(false);
    // Population changed → scan fires with the new rows.
    await runStallSweeperPatrol({ ...deps, resolveRows: async () => [row, parkedRow({ issueId: 'PAN-2', orbit: 'merge-failed' })] });
    const scans = calls.events.filter((e) => e.type === 'sweep.scan');
    expect(scans).toHaveLength(1);
    expect(scans[0].payload['rowCount']).toBe(2);
  });

  it('the per-scan action budget bounds a graveyard census', async () => {
    const rows = Array.from({ length: 8 }, (_, index) => parkedRow({ issueId: `PAN-${index + 10}`, orbit: 'merge-failed' }));
    const { deps, calls } = harness(rows);
    await runStallSweeperPatrol(deps);
    expect(calls.resetMerge.length).toBeLessThanOrEqual(4);
  });
});

describe('warm-agent re-drive (PAN-2579)', () => {
  it('stuck re-drive MESSAGES a live warm agent instead of spawning a duplicate', async () => {
    const { deps, calls } = harness(
      [parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'feedback_delivery_needs_you' } })],
      { liveAgents: ['agent-pan-1'] },
    );
    await runStallSweeperPatrol(deps);
    expect(calls.spawn).toHaveLength(0);
    expect(calls.message).toHaveLength(1);
    expect(calls.message[0]).toContain('agent-pan-1');
    expect(calls.message[0]).toContain('.pan/feedback');
    expect(calls.clearStuck).toEqual(['PAN-1']);
    expect(calls.feedback).toHaveLength(1);
  });

  it('uat re-drive also prefers the warm path for a live agent', async () => {
    const { deps, calls } = harness(
      [parkedRow({ orbit: 'uat-failed', details: { uatNotes: 'broken' } })],
      { liveAgents: ['agent-pan-1'] },
    );
    await runStallSweeperPatrol(deps);
    expect(calls.spawn).toHaveLength(0);
    expect(calls.message).toHaveLength(1);
    expect(calls.events.some((e) => e.type === 'sweep.action' && e.payload['action'] === 'uat-redrive')).toBe(true);
  });
});

describe('delivery-outcome honesty', () => {
  it('an unconfirmed warm delivery is NOT a re-drive: no feedback write, no stuck clear', async () => {
    const { deps, calls } = harness(
      [parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'feedback_delivery_needs_you' } })],
      { liveAgents: ['agent-pan-1'] },
    );
    deps.messageAgent = async () => ({ delivered: false, queuedToMail: false, reason: 'composer unverified' });
    const actions = await runStallSweeperPatrol(deps);
    expect(calls.feedback).toHaveLength(0);
    expect(calls.clearStuck).toHaveLength(0);
    expect(calls.events.some((e) => e.type === 'sweep.unparked')).toBe(false);
    expect(actions.some((a) => a.includes('delivery unconfirmed'))).toBe(true);
    expect(readSweeperRowState('PAN-1', 'stuck-flag')?.actionCount ?? 0).toBe(0);
  });

  it('an unconfirmed idle nudge records no nudge state (retries next scan)', async () => {
    const { deps } = harness(
      [parkedRow({ orbit: 'idle-running', details: { agentId: 'agent-pan-1', idleMinutes: 420 } })],
    );
    deps.messageAgent = async () => ({ delivered: false, queuedToMail: false, reason: 'composer unverified' });
    await runStallSweeperPatrol(deps);
    expect(readSweeperRowState('PAN-1', 'idle-running')?.lastNudgedAt).toBeUndefined();
  });
});
