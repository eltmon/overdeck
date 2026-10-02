/**
 * deacon-lite's silent-reviewer recovery routine (PAN-4433).
 *
 * A reviewer dispatched but never run (agent-pan-4383-review sat idle ~21 h
 * with no transcript and no review.md) is re-dispatched once, and a second
 * failure for the same (run, reviewer) surfaces as needs-you. These cases use
 * a real temp workspace and the real pipeline journal, fake time, and injected
 * liveness / transcript / dispatch doors.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../agents/agent-state-read.js';
import type { LivenessVerdict } from '../../agents/liveness.js';

const mocks = vi.hoisted(() => ({
  notifyPipeline: vi.fn(),
  emitActivityEntry: vi.fn(),
}));

vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: mocks.notifyPipeline }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));

const { appendPipelineEntry, readPipelineJournal } = await import('../pipeline-journal.js');
const {
  recoverSilentReviewers,
  __resetSilentReviewerStateForTests,
} = await import('../silent-reviewer-recovery.js');
type SilentReviewerDeps = import('../silent-reviewer-recovery.js').SilentReviewerDeps;

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const MINUTE = 60_000;
const ISSUE = 'PAN-4383';
const PARENT = 'agent-pan-4383-review';
const LANE = 'agent-pan-4383-review-security';
const RUN = 'agent-pan-4383-review-0e9e390c';

let workspace: string;
let states: AgentState[];
let deps: { [K in Exclude<keyof SilentReviewerDeps, 'reportMtimeMs'>]: SilentReviewerDeps[K] & ReturnType<typeof vi.fn> };

const idle: LivenessVerdict = { alive: true, paneAlive: true, backendState: 'idle' };

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function reviewer(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: PARENT,
    issueId: ISSUE,
    workspace,
    role: 'review',
    model: 'review-model',
    status: 'running',
    startedAt: iso(NOW - 60 * MINUTE),
    reviewRunId: RUN,
    reviewDispatchedAt: iso(NOW - 16 * MINUTE),
    ...overrides,
  } as AgentState;
}

/** Re-stamp a reviewer the way a real dispatch does: at the current (fake) time. */
function restamp(agentId: string): void {
  states = states.map((s) => (s.id === agentId ? { ...s, reviewDispatchedAt: new Date().toISOString() } : s));
}

function entries(type: string) {
  return readPipelineJournal(workspace).filter((entry) => entry.type === type);
}

function writeReport(name: string, mtimeMs: number): void {
  const dir = join(workspace, '.pan', 'review', RUN);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, '# report\n', 'utf-8');
  // writeFileSync stamps real wall-clock time; pin it to the fake clock.
  utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
}

const tick = (now = Date.now()) => recoverSilentReviewers(now, deps);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetSilentReviewerStateForTests();
  workspace = mkdtempSync(join(tmpdir(), 'deacon-lite-silent-reviewer-'));
  appendPipelineEntry(workspace, { type: 'verification.passed', issueId: ISSUE, source: 'request-review', data: { head: '0e9e390c' } });
  states = [reviewer()];
  // reportMtimeMs is not injected: the default stats the temp workspace's real files.
  deps = {
    listReviewStates: vi.fn(() => states),
    readState: vi.fn((agentId: string) => states.find((s) => s.id === agentId) ?? null),
    isAlive: vi.fn(async () => idle),
    transcriptActivityMs: vi.fn(async () => null),
    currentRunId: vi.fn(async () => RUN),
    stallMs: vi.fn(() => 15 * MINUTE),
    getIssuePause: vi.fn(() => ({ status: 'unpaused' as const })),
    resumeGateAllows: vi.fn(() => true),
    redispatchLane: vi.fn(async (_issueId: string, laneId: string) => {
      restamp(laneId);
      return { success: true, message: 'Recovered 1 missing reviewer' };
    }),
    redispatchParent: vi.fn(async (_issueId: string, _workspace: string, saved: AgentState) => {
      restamp(saved.id);
      return { success: true, message: `Self-review spawned: ${saved.id}` };
    }),
    surfaceNeedsYou: vi.fn(async () => undefined),
  } as unknown as typeof deps;
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(workspace, { recursive: true, force: true });
});

describe('recoverSilentReviewers — normal review', () => {
  it('leaves a reviewer that wrote its transcript after the dispatch alone', async () => {
    states = [reviewer({ reviewDispatchedAt: iso(NOW - 20 * MINUTE) })];
    deps.transcriptActivityMs.mockResolvedValue(NOW - 19 * MINUTE);

    expect(await tick()).toEqual([]);
    expect(entries('review.stalled')).toHaveLength(0);
    expect(deps.redispatchParent).not.toHaveBeenCalled();
  });

  it('leaves a reviewer that wrote its report after the dispatch alone', async () => {
    writeReport('review.md', NOW - 5 * MINUTE);

    expect(await tick()).toEqual([]);
    expect(entries('review.stalled')).toHaveLength(0);
    expect(deps.redispatchParent).not.toHaveBeenCalled();
  });
});

describe('recoverSilentReviewers — stuck then re-dispatched', () => {
  it('journals review.stalled once and re-dispatches a silent quick-mode parent', async () => {
    const actions = await tick();

    expect(actions).toEqual([`recoverSilentReviewers: re-dispatched silent ${PARENT} for ${ISSUE} — Self-review spawned: ${PARENT}`]);
    const stalled = entries('review.stalled');
    expect(stalled).toHaveLength(1);
    expect(stalled[0]).toMatchObject({
      issueId: ISSUE,
      source: 'deacon-lite',
      data: { runId: RUN, reviewer: PARENT, paneState: 'idle', attempt: 1, silentForMs: 16 * MINUTE, dispatchedAt: iso(NOW - 16 * MINUTE) },
    });
    expect(deps.redispatchParent).toHaveBeenCalledTimes(1);
    expect(deps.redispatchParent).toHaveBeenCalledWith(ISSUE, workspace, expect.objectContaining({ id: PARENT }));
    expect(deps.surfaceNeedsYou).not.toHaveBeenCalled();
    expect(entries('review.stall-escalated')).toHaveLength(0);
    // D6: never review.redispatched — recoverStalledReviews would launch lanes on a quick issue.
    expect(entries('review.redispatched')).toHaveLength(0);
    expect(mocks.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({ source: 'review', level: 'warn', issueId: ISSUE }));

    // A second tick at the same time sees the fresh dispatch stamp: too young.
    expect(await tick()).toEqual([]);
    expect(entries('review.stalled')).toHaveLength(1);
    expect(deps.redispatchParent).toHaveBeenCalledTimes(1);
  });

  it('re-dispatches a silent convoy lane through the lane door', async () => {
    states = [reviewer({ id: LANE, reviewSubRole: 'security', reviewOutputPath: join(workspace, '.pan', 'review', RUN, 'security.md') })];

    await tick();

    expect(deps.redispatchLane).toHaveBeenCalledTimes(1);
    expect(deps.redispatchLane).toHaveBeenCalledWith(ISSUE, LANE);
    expect(deps.redispatchParent).not.toHaveBeenCalled();
    expect(entries('review.stalled')[0]?.data).toMatchObject({ reviewer: LANE, attempt: 1 });
  });

  it('acts on one reviewer per issue per tick', async () => {
    states = [
      reviewer({ id: `${PARENT}-security`, reviewSubRole: 'security' }),
      reviewer({ id: `${PARENT}-correctness`, reviewSubRole: 'correctness' }),
    ];

    await tick();

    expect(deps.redispatchLane).toHaveBeenCalledTimes(1);
    expect(entries('review.stalled')).toHaveLength(1);
  });
});

describe('recoverSilentReviewers — stuck twice → needs-you', () => {
  it('escalates a re-dispatched parent that is silent again and never re-dispatches it twice', async () => {
    await tick();
    vi.setSystemTime(NOW + 16 * MINUTE);

    const actions = await tick();

    expect(actions).toEqual([`recoverSilentReviewers: escalated silent ${PARENT} for ${ISSUE} — silent again after re-dispatch`]);
    const escalated = entries('review.stall-escalated');
    expect(escalated).toHaveLength(1);
    expect(escalated[0]?.data).toMatchObject({ runId: RUN, reviewer: PARENT, paneState: 'idle', attempt: 2, reason: 'silent again after re-dispatch' });
    expect(deps.surfaceNeedsYou).toHaveBeenCalledTimes(1);
    const [issueId, reason, details] = deps.surfaceNeedsYou.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(issueId).toBe(ISSUE);
    expect(reason).toContain(PARENT);
    expect(reason).toContain('pane idle');
    expect(details).toMatchObject({ reviewer: PARENT, runId: RUN, paneState: 'idle', attempts: 2 });
    expect(deps.redispatchParent).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + 60 * MINUTE);
    expect(await tick()).toEqual([]);
    expect(entries('review.stall-escalated')).toHaveLength(1);
    expect(deps.surfaceNeedsYou).toHaveBeenCalledTimes(1);
    expect(deps.redispatchParent).toHaveBeenCalledTimes(1);
  });

  it('escalates a re-dispatched reviewer that died without a report', async () => {
    await tick();
    vi.setSystemTime(NOW + 16 * MINUTE);
    deps.isAlive.mockResolvedValue({ alive: false, reason: 'pane-dead' });
    // It even started a transcript before it died: still no report.
    deps.transcriptActivityMs.mockResolvedValue(NOW + MINUTE);

    await tick();

    const escalated = entries('review.stall-escalated');
    expect(escalated).toHaveLength(1);
    expect(escalated[0]?.data).toMatchObject({ paneState: 'pane-dead', attempt: 2, reason: 'died without a report after re-dispatch' });
    expect(deps.surfaceNeedsYou.mock.calls[0]?.[1]).toContain('pane pane-dead');
    expect(deps.redispatchParent).toHaveBeenCalledTimes(1);
  });

  it('leaves a re-dispatched reviewer that is working', async () => {
    await tick();
    vi.setSystemTime(NOW + 16 * MINUTE);
    deps.transcriptActivityMs.mockResolvedValue(NOW + MINUTE);

    expect(await tick()).toEqual([]);
    expect(entries('review.stall-escalated')).toHaveLength(0);
  });

  it('gives a new run a fresh budget', async () => {
    await tick();
    const nextRun = 'agent-pan-4383-review-11111111';
    states = [reviewer({ reviewRunId: nextRun, reviewDispatchedAt: iso(NOW) })];
    deps.currentRunId.mockResolvedValue(nextRun);
    vi.setSystemTime(NOW + 16 * MINUTE);

    await tick();

    expect(entries('review.stalled')).toHaveLength(2);
    expect(entries('review.stall-escalated')).toHaveLength(0);
    expect(deps.redispatchParent).toHaveBeenCalledTimes(2);
  });
});

describe('recoverSilentReviewers — failed re-dispatch escalates at once', () => {
  it('escalates in the same tick when the door returns success: false', async () => {
    deps.redispatchParent.mockResolvedValue({ success: false, gated: true, message: 'merge conflict with main' });

    await tick();

    expect(entries('review.stalled')).toHaveLength(1);
    const escalated = entries('review.stall-escalated');
    expect(escalated).toHaveLength(1);
    expect(escalated[0]?.data).toMatchObject({ reviewer: PARENT, reason: 're-dispatch failed: merge conflict with main' });
    expect(deps.surfaceNeedsYou).toHaveBeenCalledTimes(1);
    expect(deps.surfaceNeedsYou.mock.calls[0]?.[1]).toContain('re-dispatch failed: merge conflict with main');
  });

  it('escalates in the same tick when the door throws', async () => {
    deps.redispatchParent.mockRejectedValue(new Error('removeAgentStateDir: EACCES'));

    await tick();

    expect(entries('review.stall-escalated')[0]?.data).toMatchObject({ reason: 're-dispatch failed: removeAgentStateDir: EACCES' });
    expect(deps.surfaceNeedsYou).toHaveBeenCalledTimes(1);
  });
});

describe('recoverSilentReviewers — guards', () => {
  function expectNothing(): void {
    expect(entries('review.stalled')).toHaveLength(0);
    expect(entries('review.stall-escalated')).toHaveLength(0);
    expect(deps.redispatchParent).not.toHaveBeenCalled();
    expect(deps.redispatchLane).not.toHaveBeenCalled();
    expect(deps.surfaceNeedsYou).not.toHaveBeenCalled();
  }

  it('waits until stallMs has passed since the dispatch', async () => {
    states = [reviewer({ reviewDispatchedAt: iso(NOW - 14 * MINUTE) })];
    await tick();
    expectNothing();
  });

  it('honours roles.review.stallMinutes', async () => {
    states = [reviewer({ reviewDispatchedAt: iso(NOW - 6 * MINUTE) })];
    deps.stallMs.mockReturnValue(5 * MINUTE);
    await tick();
    expect(deps.redispatchParent).toHaveBeenCalledTimes(1);
  });

  it('skips a reviewer dispatched before the stamp existed', async () => {
    states = [reviewer({ reviewDispatchedAt: undefined })];
    await tick();
    expectNothing();
  });

  it('never acts on indeterminate liveness', async () => {
    deps.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });
    await tick();
    expectNothing();
  });

  it('leaves a pane blocked on a prompt to the needs-you it already raised', async () => {
    deps.isAlive.mockResolvedValue({ alive: true, paneAlive: true, backendState: 'blocked' });
    await tick();
    expectNothing();
  });

  it('skips a paused issue', async () => {
    deps.getIssuePause.mockReturnValue({ status: 'paused', agentId: 'x', stoppedAgents: [] });
    await tick();
    expectNothing();
  });

  it('skips an operator-held reviewer', async () => {
    deps.resumeGateAllows.mockReturnValue(false);
    await tick();
    expectNothing();
  });

  it('skips a stale run', async () => {
    deps.currentRunId.mockResolvedValue('agent-pan-4383-review-22222222');
    await tick();
    expectNothing();
  });

  it('skips a run whose verdict is already journaled', async () => {
    appendPipelineEntry(workspace, { type: 'review.verdict', issueId: ISSUE, data: { runId: RUN, verdict: 'APPROVED' } });
    await tick();
    expectNothing();
  });

  it('skips a review aborted since the dispatch', async () => {
    appendPipelineEntry(workspace, { type: 'review.aborted', issueId: ISSUE, data: { killed: [PARENT] } });
    await tick();
    expectNothing();
  });

  it('leaves a first-time dead reviewer to the existing recovery routines', async () => {
    deps.isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
    await tick();
    expectNothing();
  });

  it('bails when the reviewer was re-dispatched between the probe and the act', async () => {
    deps.readState.mockReturnValue(reviewer({ reviewDispatchedAt: iso(NOW) }));
    await tick();
    expectNothing();
  });

  it('keeps going when one reviewer throws', async () => {
    states = [reviewer({ id: 'agent-pan-9999-review', issueId: 'PAN-9999' }), reviewer()];
    deps.transcriptActivityMs.mockImplementation(async (agentId: string) => {
      if (agentId === 'agent-pan-9999-review') throw new Error('boom');
      return null;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(tick()).resolves.toHaveLength(1);
    expect(deps.redispatchParent).toHaveBeenCalledTimes(1);
  });
});

describe('recoverSilentReviewers — report freshness', () => {
  it('does not count a report written before the dispatch stamp', async () => {
    writeReport('review.md', NOW - 30 * MINUTE);

    await tick();

    expect(deps.redispatchParent).toHaveBeenCalledTimes(1);
  });

  it('leaves a reviewer with an old report but a fresh transcript write alone', async () => {
    writeReport('review.md', NOW - 30 * MINUTE);
    deps.transcriptActivityMs.mockResolvedValue(NOW - 10 * MINUTE);

    expect(await tick()).toEqual([]);
    expect(entries('review.stalled')).toHaveLength(0);
    expect(deps.redispatchParent).not.toHaveBeenCalled();
  });

  it('counts a synthesis written since the stamp for the parent', async () => {
    writeReport('synthesis.md', NOW - MINUTE);

    await tick();

    expect(deps.redispatchParent).not.toHaveBeenCalled();
  });
});
