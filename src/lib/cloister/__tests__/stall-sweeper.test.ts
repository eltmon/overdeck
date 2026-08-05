/**
 * Fixture tests for the stall sweeper patrol (PAN-3485 phase 2), observability-
 * only contract (operator directive 2026-08-05).
 *
 * The sweeper DETECTS parked work and emits recommendations (sweep.recommendation
 * events + activity-feed entries). It must never act: there are no action deps
 * to inject, and every feed entry carries the "Observability-only: no action
 * taken" trailer. These tests pin each orbit's recommendation, the cooldowns,
 * the exhaustion escalation, and the no-action-door source guard.
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

import {
  runStallSweeperPatrol,
  SWEEP_MAX_ACTIONS_PER_ROW,
  type StallSweeperDeps,
} from '../stall-sweeper.js';
import { writeSweeperRowState, writeSweeperSignature } from '../stall-sweeper-state.js';
import type { ParkedRow } from '../../parked/resolver.js';
import type { SynthesisArtifactVerdict } from '../synthesis-verdict.js';

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
    events: { type: string; payload: Record<string, unknown> }[];
    activity: { level: string; issueId?: string; message: string }[];
  };
}

function harness(
  rows: ParkedRow[],
  opts: { liveAgents?: string[]; artifact?: SynthesisArtifactVerdict | null } = {},
): Harness {
  const calls: Harness['calls'] = { events: [], activity: [] };
  const live = new Set(opts.liveAgents ?? []);
  const deps: StallSweeperDeps = {
    now: NOW,
    resolveRows: async () => rows,
    readArtifact: () => opts.artifact ?? null,
    isAgentLive: (agentId) => live.has(agentId),
    emitActivity: (entry) => { calls.activity.push(entry); },
    emitEvent: (type, payload) => { calls.events.push({ type, payload }); },
  };
  return { deps, calls };
}

function recommendations(h: Harness): { type: string; payload: Record<string, unknown> }[] {
  return h.calls.events.filter((e) => e.type === 'sweep.recommendation');
}

beforeEach(() => {
  savedHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'sweeper-test-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe('runStallSweeperPatrol — per-orbit recommendations (observability-only)', () => {
  it('zombie-session: recommends reaping the zombie, never reaps', async () => {
    const h = harness([parkedRow({ orbit: 'zombie-session', details: { agentId: 'agent-pan-1' } })]);
    const actions = await runStallSweeperPatrol(h.deps);
    const recs = recommendations(h);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain('reap zombie session agent-pan-1');
    expect(actions.join(' ')).toContain('recommended');
    expect(h.calls.activity[0]!.message).toContain('Observability-only: no action taken.');
  });

  it('merge-failed: recommends a merge re-evaluation', async () => {
    const h = harness([parkedRow({ orbit: 'merge-failed' })]);
    await runStallSweeperPatrol(h.deps);
    const recs = recommendations(h);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain('merge for re-evaluation');
  });

  it('uat-failed: recommends a UAT rework re-drive with the notes as evidence', async () => {
    const h = harness([parkedRow({ orbit: 'uat-failed', details: { uatNotes: 'login flow broken' } })]);
    await runStallSweeperPatrol(h.deps);
    const recs = recommendations(h);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain('UAT rework');
    expect(String(recs[0]!.payload.uatNotes)).toContain('login flow broken');
  });

  it('stuck-flag review_infrastructure_failure: recommends clear + re-dispatch, never clears', async () => {
    const h = harness([parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'review_infrastructure_failure' } })]);
    await runStallSweeperPatrol(h.deps);
    const recs = recommendations(h);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain('re-dispatch the review');
  });

  it('stuck-flag feedback_delivery_needs_you: recommends a rework resume', async () => {
    const h = harness([parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'feedback_delivery_needs_you' } })]);
    await runStallSweeperPatrol(h.deps);
    const recs = recommendations(h);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain('rework');
  });

  it.each([
    'review_infrastructure_failure',
    'feedback_delivery_needs_you',
    'verification_stuck',
  ])('stuck-flag %s + fresh PASSED artifact: preserves evidence and awaits the canonical signal', async (stuckReason) => {
    const artifact = {
      verdict: 'passed',
      runId: 'agent-pan-1-review-run-att1',
      headSha: 'a'.repeat(40),
      mtimeMs: NOW - 60_000,
    } as const;
    const h = harness(
      [parkedRow({ orbit: 'stuck-flag', details: { stuckReason } })],
      { artifact },
    );

    await runStallSweeperPatrol(h.deps);

    const recs = recommendations(h);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain('preserve PAN-1');
    expect(String(recs[0]!.payload.recommendation)).toContain('do not re-dispatch or resume rework');
    expect(recs[0]!.payload).toMatchObject({
      artifactVerdict: 'passed',
      artifactRunId: artifact.runId,
      artifactHead: artifact.headSha,
    });
    expect(h.calls.activity[0]!.message).toContain('Observability-only: no action taken.');
  });

  it('stuck-flag + fresh BLOCKED artifact: recommends rework with the reviewer blocker as evidence', async () => {
    const artifact = {
      verdict: 'blocked',
      runId: 'agent-pan-1-review-run-att1',
      notes: 'null deref in the parser',
      mtimeMs: NOW - 60_000,
    } as const;
    const h = harness(
      [parkedRow({ orbit: 'stuck-flag', details: { stuckReason: 'feedback_delivery_needs_you' } })],
      { artifact },
    );

    await runStallSweeperPatrol(h.deps);

    const recs = recommendations(h);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain(`review run ${artifact.runId}`);
    expect(recs[0]!.payload.reviewNotes).toBe(artifact.notes);
  });

  it('conflicts: recommends sync-main + rework', async () => {
    const h = harness([parkedRow({ orbit: 'conflicts' })]);
    await runStallSweeperPatrol(h.deps);
    const recs = recommendations(h);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain('sync-main');
  });

  it('idle-running: recommends a nudge, then stopping if nothing moves', async () => {
    const row = parkedRow({ orbit: 'idle-running', details: { agentId: 'agent-pan-1', idleMinutes: 7200 } });
    const h = harness([row], { liveAgents: ['agent-pan-1'] });
    await runStallSweeperPatrol(h.deps);
    let recs = recommendations(h);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain('nudge agent-pan-1');

    // Second scan past the grace window with the agent still idle: recommend stopping.
    writeSweeperRowState('PAN-1', 'idle-running', {
      actionCount: 1,
      lastActionAt: new Date(NOW - 2 * HOUR).toISOString(),
      episodeStartedAt: new Date(NOW - 5 * HOUR).toISOString(),
      lastNudgedAt: new Date(NOW - 2 * HOUR).toISOString(),
    });
    const h2 = harness([row], { liveAgents: ['agent-pan-1'] });
    await runStallSweeperPatrol(h2.deps);
    recs = recommendations(h2);
    expect(recs).toHaveLength(1);
    expect(String(recs[0]!.payload.recommendation)).toContain('stop or resume agent-pan-1');
  });
});

describe('runStallSweeperPatrol — gates, exhaustion, escalation', () => {
  it('operator-gate rows are NEVER recommended, only re-surfaced on TTL', async () => {
    const h = harness([parkedRow({ orbit: 'operator-gate' })]);
    await runStallSweeperPatrol(h.deps);
    expect(recommendations(h)).toHaveLength(0);
    expect(h.calls.events.some((e) => e.type === 'sweep.escalated')).toBe(true);
  });

  it('a row that exhausted its recommendation budget escalates instead of recommending', async () => {
    writeSweeperRowState('PAN-1', 'merge-failed', {
      actionCount: SWEEP_MAX_ACTIONS_PER_ROW,
      lastActionAt: new Date(NOW - 3 * HOUR).toISOString(),
      episodeStartedAt: new Date(NOW - 5 * HOUR).toISOString(),
    });
    const h = harness([parkedRow({ orbit: 'merge-failed' })]);
    await runStallSweeperPatrol(h.deps);
    expect(recommendations(h)).toHaveLength(0);
    expect(h.calls.events.some((e) => e.type === 'sweep.escalated'
      && String(e.payload.reason).includes('exhausted'))).toBe(true);
  });

  it('recommendations cool down per orbit', async () => {
    writeSweeperRowState('PAN-1', 'merge-failed', {
      actionCount: 1,
      lastActionAt: new Date(NOW - 30 * 60_000).toISOString(), // inside the 2h cooldown
      episodeStartedAt: new Date(NOW - 5 * HOUR).toISOString(),
    });
    const h = harness([parkedRow({ orbit: 'merge-failed' })]);
    await runStallSweeperPatrol(h.deps);
    expect(recommendations(h)).toHaveLength(0);
  });

  it('sweep.scan fires on population change only', async () => {
    writeSweeperSignature('PAN-1:merge-failed');
    const h = harness([parkedRow({ orbit: 'merge-failed' })]);
    await runStallSweeperPatrol(h.deps);
    expect(h.calls.events.some((e) => e.type === 'sweep.scan')).toBe(false);
  });
});

