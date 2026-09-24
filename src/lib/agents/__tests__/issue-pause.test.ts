/**
 * The issue pause (PAN-3911), against real state files in a scratch
 * OVERDECK_HOME. Only the terminal backend (liveness probe, pane closes, tmux,
 * pgrep), the dashboard HTTP door and the convoy relauncher are stubbed; the
 * pause gate, the sweep, the journal, `pan pause`/`pan unpause` and
 * stalled-review recovery all run for real.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// paths.ts resolves the agents dir at module load, so the home has to point at
// a scratch directory before the subject's imports are evaluated.
const testHome = vi.hoisted(() => {
  const { mkdtempSync: makeTemp } = require('node:fs') as typeof import('node:fs');
  const { tmpdir: temp } = require('node:os') as typeof import('node:os');
  const { join: joinPath } = require('node:path') as typeof import('node:path');
  const home = makeTemp(joinPath(temp(), 'issue-pause-'));
  process.env.OVERDECK_HOME = home;
  return home;
});

const mocks = vi.hoisted(() => ({
  isAlive: vi.fn(),
  agentPaneExists: vi.fn(),
  closeAgentPaneDetailed: vi.fn(),
  closeIssuePanes: vi.fn(),
  requestReviewViaDashboard: vi.fn(),
  resumeAgent: vi.fn(),
  liveAgentInventory: vi.fn(),
  listWorkspaces: vi.fn(),
  recoverMissingConvoyReviewers: vi.fn(),
  appendOperatorInterventionEvent: vi.fn(),
}));

vi.mock('../liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../liveness.js')>()),
  isAlive: mocks.isAlive,
}));
vi.mock('../../terminal-backends/launch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../terminal-backends/launch.js')>()),
  agentPaneExists: mocks.agentPaneExists,
  closeAgentPaneDetailed: mocks.closeAgentPaneDetailed,
  closeAgentPane: async (id: string) => (await mocks.closeAgentPaneDetailed(id)).outcome === 'closed',
  closeIssuePanes: mocks.closeIssuePanes,
}));
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  sessionExists: () => Effect.succeed(false),
}));
vi.mock('../../agent-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent-runtime.js')>()),
  emitAgentEvent: () => Effect.void,
}));
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  // pgrep for launcher.sh: report "no match" so a stop never signals anything.
  exec: (_cmd: string, ...rest: unknown[]) => {
    const cb = rest.at(-1) as (err: Error) => void;
    cb(new Error('no match'));
  },
}));
vi.mock('../../operator-interventions.js', () => ({
  appendOperatorInterventionEvent: mocks.appendOperatorInterventionEvent,
}));
vi.mock('../../../cli/commands/request-review.js', () => ({
  requestReviewViaDashboard: mocks.requestReviewViaDashboard,
}));
vi.mock('../resume.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../resume.js')>()),
  resumeAgent: mocks.resumeAgent,
}));
vi.mock('../../work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleState: async () => ({ canResumeSession: false }),
}));
vi.mock('../../terminal-backends/inventory.js', () => ({ liveAgentInventory: mocks.liveAgentInventory }));
vi.mock('../../workspaces/resolver.js', () => ({ listWorkspaces: mocks.listWorkspaces }));
vi.mock('../../cloister/review-convoy.js', () => ({
  recoverMissingConvoyReviewers: mocks.recoverMissingConvoyReviewers,
}));

const { getAgentState, getIssuePause, setAgentPaused, setAgentYielded, saveAgentStateSync } = await import('../agent-state.js');
const { stopIssueSpecialistAgents } = await import('../issue-pause.js');
const { messageAgent } = await import('../messaging.js');
const { pauseCommand } = await import('../../../cli/commands/pause.js');
const { unpauseCommand } = await import('../../../cli/commands/unpause.js');
const { recoverStalledReviews, __resetStalledReviewCooldownForTests } = await import('../../cloister/deacon-lite.js');
const { appendPipelineEntry, readPipelineJournal } = await import('../../cloister/pipeline-journal.js');

const ISSUE = 'PAN-3911';
const WORK = 'agent-pan-3911';
const PARENT = 'agent-pan-3911-review';
const LANE = 'agent-pan-3911-review-security';
const TEST_AGENT = 'agent-pan-3911-test';

let workspace: string;

function seed(id: string, fields: Record<string, unknown>): void {
  const dir = join(testHome, 'agents', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    id,
    issueId: ISSUE,
    role: 'review',
    status: 'running',
    workspace,
    model: 'test-model',
    startedAt: '2026-09-24T09:00:00.000Z',
    ...fields,
  }));
}

function seedConvoy(): void {
  seed(WORK, { role: 'work' });
  seed(PARENT, {});
  seed(LANE, { reviewSubRole: 'security', reviewSynthesisAgentId: PARENT });
}

function journalReviewDispatched(minutesAgo: number): void {
  vi.setSystemTime(Date.now() - minutesAgo * 60_000);
  appendPipelineEntry(workspace, { type: 'review.dispatched', issueId: ISSUE });
  vi.useRealTimers();
}

beforeEach(() => {
  vi.clearAllMocks();
  rmSync(join(testHome, 'agents'), { recursive: true, force: true });
  workspace = mkdtempSync(join(tmpdir(), 'issue-pause-ws-'));
  __resetStalledReviewCooldownForTests();
  mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true });
  mocks.agentPaneExists.mockResolvedValue(true);
  mocks.closeAgentPaneDetailed.mockResolvedValue({ outcome: 'closed' });
  mocks.closeIssuePanes.mockResolvedValue([]);
  mocks.requestReviewViaDashboard.mockResolvedValue({ kind: 'ok', status: 200, result: { message: 'ok' } });
  mocks.resumeAgent.mockResolvedValue({ success: true });
  mocks.liveAgentInventory.mockResolvedValue({ backend: 'herdr', panes: [] });
  mocks.listWorkspaces.mockImplementation(() => [{ id: 'ws1', issueId: ISSUE, path: workspace }]);
  mocks.recoverMissingConvoyReviewers.mockResolvedValue({ success: true, message: 'relaunched lanes', launched: 1 });
  mocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  process.exitCode = undefined;
  rmSync(workspace, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

describe('getIssuePause', () => {
  it('is paused only for an operator pause of the issue work agent', async () => {
    seed(WORK, { role: 'work' });
    expect(getIssuePause(ISSUE)).toEqual({ status: 'unpaused' });

    await Effect.runPromise(setAgentPaused(WORK, 'cut spend', true, true));
    expect(getIssuePause(ISSUE)).toMatchObject({ status: 'paused', agentId: WORK, pausedReason: 'cut spend' });
  });

  it('does not count a machine pause (memory shed, post-merge, migration) as an issue pause', async () => {
    seed(WORK, { role: 'work' });
    await Effect.runPromise(setAgentPaused(WORK, '[governor-slot] memory pressure', true));
    expect(getAgentState(WORK)?.paused).toBe(true);
    expect(getIssuePause(ISSUE)).toEqual({ status: 'unpaused' });
  });

  it('does not count a scheduler yield, but an operator pause on a yielded agent counts and drops the yield', async () => {
    seed(WORK, { role: 'work' });
    setAgentYielded(WORK, 'yield for PAN-1');
    expect(getIssuePause(ISSUE)).toEqual({ status: 'unpaused' });

    await Effect.runPromise(setAgentPaused(WORK, 'hold', true, true));
    expect(getIssuePause(ISSUE).status).toBe('paused');
    expect(getAgentState(WORK)?.yieldedByScheduler).toBeUndefined();
  });

  it('does not treat a swarm slot pause as an issue pause', async () => {
    seed(WORK, { role: 'work' });
    seed('agent-pan-3911-slot-1', { role: 'work' });
    await Effect.runPromise(setAgentPaused('agent-pan-3911-slot-1', 'hold slot', true, true));
    expect(getIssuePause(ISSUE)).toEqual({ status: 'unpaused' });
  });

  it('is unknown, never unpaused, when the state file is unparsable', () => {
    mkdirSync(join(testHome, 'agents', WORK), { recursive: true });
    writeFileSync(join(testHome, 'agents', WORK, 'state.json'), '');
    expect(getIssuePause(ISSUE)).toMatchObject({ status: 'unknown', agentId: WORK });
  });

  it.skipIf(process.getuid?.() === 0)('is unknown, not a throw, when the state file cannot be read', () => {
    seed(WORK, { role: 'work', paused: true, pausedBy: 'operator' });
    const file = join(testHome, 'agents', WORK, 'state.json');
    chmodSync(file, 0o000);
    try {
      expect(getIssuePause(ISSUE)).toMatchObject({ status: 'unknown', agentId: WORK });
    } finally {
      chmodSync(file, 0o644);
    }
  });

  it('is unpaused when the issue has no work agent', () => {
    expect(getIssuePause(ISSUE)).toEqual({ status: 'unpaused' });
  });
});

describe('stopIssueSpecialistAgents', () => {
  it("stops only this issue's running review and test agents, the synthesis parent last", async () => {
    seedConvoy();
    seed('agent-pan-3911-review-logic', { reviewSubRole: 'logic', status: 'stopped' });
    seed(TEST_AGENT, { role: 'test', status: 'starting' });
    // A prefix sibling: PAN-39110 is another issue.
    seed('agent-pan-39110-review', { issueId: 'PAN-39110' });
    seed('agent-pan-39110-review-security', { issueId: 'PAN-39110' });
    mocks.isAlive.mockImplementation(async (id: string) => (
      id === 'agent-pan-3911-review-logic'
        ? { alive: false, reason: 'no-session' }
        : { alive: true, paneAlive: true }
    ));

    const sweep = await stopIssueSpecialistAgents(ISSUE);

    expect(new Set(sweep.stopped)).toEqual(new Set([LANE, TEST_AGENT, PARENT]));
    expect(sweep.stopped.at(-1)).toBe(PARENT);
    expect(sweep.failed).toEqual([]);
    expect(sweep.unknown).toEqual([]);
    const closed = mocks.closeAgentPaneDetailed.mock.calls.map(([id]) => id);
    expect(closed).not.toContain('agent-pan-39110-review');
    expect(closed).not.toContain('agent-pan-39110-review-security');
    expect(closed).not.toContain(WORK);
    expect(closed).not.toContain('agent-pan-3911-review-logic');
    expect(getAgentState('agent-pan-39110-review')?.status).toBe('running');
    // Stopped with cause 'system': no per-agent operator-stop gate.
    expect(getAgentState(PARENT)).toMatchObject({ status: 'stopped' });
    expect(getAgentState(PARENT)?.stoppedByUser).toBeUndefined();
    expect(mocks.closeIssuePanes).toHaveBeenCalledWith(ISSUE, { roles: ['review', 'test'] });
  });

  it('reports a failed Herdr close and keeps stopping the others', async () => {
    seedConvoy();
    seed(TEST_AGENT, { role: 'test' });
    mocks.closeAgentPaneDetailed.mockImplementation(async (id: string) => (
      id === LANE ? { outcome: 'failed', reason: 'herdr could not close pane p_7' } : { outcome: 'closed' }
    ));

    const sweep = await stopIssueSpecialistAgents(ISSUE);

    expect(sweep.failed).toEqual([{ agentId: LANE, reason: 'herdr could not close pane p_7' }]);
    expect(new Set(sweep.stopped)).toEqual(new Set([TEST_AGENT, PARENT]));
  });

  it('counts a reviewer as stopped once the Herdr second pass closes the pane its first close missed', async () => {
    seedConvoy();
    mocks.closeAgentPaneDetailed.mockImplementation(async (id: string) => (
      id === LANE ? { outcome: 'failed', reason: 'herdr could not close pane p_7' } : { outcome: 'closed' }
    ));
    mocks.closeIssuePanes.mockResolvedValue([LANE]);

    const sweep = await stopIssueSpecialistAgents(ISSUE);

    expect(sweep.failed).toEqual([]);
    expect(new Set(sweep.stopped)).toEqual(new Set([LANE, PARENT]));
    expect(sweep.closedPanes).toEqual([]);
  });

  it('leaves an agent of unknown liveness alone and skips the Herdr second pass', async () => {
    seedConvoy();
    mocks.isAlive.mockImplementation(async (id: string) => (
      id === LANE ? { alive: false, reason: 'runtime-indeterminate' } : { alive: true, paneAlive: true }
    ));

    const sweep = await stopIssueSpecialistAgents(ISSUE);

    expect(sweep.unknown).toEqual([{ agentId: LANE, reason: 'liveness could not be determined' }]);
    expect(sweep.stopped).toEqual([PARENT]);
    expect(mocks.closeAgentPaneDetailed.mock.calls.map(([id]) => id)).not.toContain(LANE);
    expect(mocks.closeIssuePanes).not.toHaveBeenCalled();
  });

  it('reports the review panes the second pass closed that no agent row listed', async () => {
    seedConvoy();
    mocks.closeIssuePanes.mockResolvedValue(['agent-pan-3911-review-performance']);

    const sweep = await stopIssueSpecialistAgents(ISSUE);

    expect(sweep.closedPanes).toEqual(['agent-pan-3911-review-performance']);
  });
});

describe('pan pause, then pan unpause (PAN-3911)', () => {
  it('re-requests a fresh review through the review door, never convoy recovery against the stopped parent', async () => {
    seedConvoy();
    journalReviewDispatched(30);

    await pauseCommand(ISSUE, { reason: 'cut spend' });

    expect(getAgentState(WORK)).toMatchObject({ paused: true, pausedBy: 'operator' });
    expect(new Set(getAgentState(WORK)?.pauseStoppedAgents)).toEqual(new Set([LANE, PARENT]));
    expect(getAgentState(PARENT)?.status).toBe('stopped');
    expect(readPipelineJournal(workspace).at(-1)).toMatchObject({ type: 'review.halted', source: 'pan-pause' });
    // While paused, and on every tick after: nothing relaunches lanes at the stopped parent.
    expect(await recoverStalledReviews(Date.now() + 60 * 60_000)).toEqual([]);

    // Someone stops the parent by hand during the pause: unpause clears that gate too.
    const parent = getAgentState(PARENT)!;
    parent.stoppedByUser = true;
    saveAgentStateSync(parent);

    await unpauseCommand(ISSUE);

    expect(mocks.requestReviewViaDashboard).toHaveBeenCalledTimes(1);
    expect(mocks.requestReviewViaDashboard).toHaveBeenCalledWith(ISSUE, expect.any(String), 120_000, 'pan-unpause');
    expect(getAgentState(PARENT)?.stoppedByUser).toBeUndefined();
    expect(getAgentState(WORK)?.paused).toBeUndefined();
    expect(getAgentState(WORK)?.pauseStoppedAgents).toBeUndefined();
    expect(process.exitCode).toBeUndefined();
    expect(await recoverStalledReviews(Date.now() + 2 * 60 * 60_000)).toEqual([]);
    expect(mocks.recoverMissingConvoyReviewers).not.toHaveBeenCalled();
  });

  it('surfaces a review re-request the dashboard could not take', async () => {
    seedConvoy();
    await pauseCommand(ISSUE, {});
    mocks.requestReviewViaDashboard.mockResolvedValue({ kind: 'unreachable', error: 'ECONNREFUSED' });

    await unpauseCommand(ISSUE);

    expect(process.exitCode).toBe(1);
    const errors = vi.mocked(console.error).mock.calls.map(([line]) => String(line)).join('\n');
    expect(errors).toContain('Review not re-requested for PAN-3911');
    expect(errors).toContain(`pan review request ${ISSUE}`);
  });

  it('requests no review when the pause stopped no reviewers', async () => {
    seed(WORK, { role: 'work' });
    await pauseCommand(ISSUE, {});
    await unpauseCommand(ISSUE);
    expect(mocks.requestReviewViaDashboard).not.toHaveBeenCalled();
  });

  it('surfaces a failed close of the work agent pane and of a reviewer instead of reporting them stopped', async () => {
    seedConvoy();
    mocks.closeAgentPaneDetailed.mockImplementation(async (id: string) => (
      id === WORK || id === LANE ? { outcome: 'failed', reason: `herdr could not close ${id}` } : { outcome: 'closed' }
    ));

    await pauseCommand(ISSUE, {});

    expect(process.exitCode).toBe(1);
    const errors = vi.mocked(console.error).mock.calls.map(([line]) => String(line)).join('\n');
    expect(errors).toContain(`herdr could not close ${WORK}`);
    expect(errors).toContain(`could not stop ${LANE}: herdr could not close ${LANE}`);
    const logs = vi.mocked(console.log).mock.calls.map(([line]) => String(line)).join('\n');
    expect(logs).not.toContain(`Paused and stopped agent: ${WORK}`);
    expect(getAgentState(WORK)?.pauseStoppedAgents).toEqual([PARENT]);
  });

  it('pausing a swarm slot stops no reviewers and does not pause the issue', async () => {
    seedConvoy();
    seed('agent-pan-3911-slot-1', { role: 'work' });
    journalReviewDispatched(30);

    await pauseCommand('agent-pan-3911-slot-1', {});

    expect(mocks.closeAgentPaneDetailed.mock.calls.map(([id]) => id)).toEqual(['agent-pan-3911-slot-1']);
    expect(getAgentState(PARENT)?.status).toBe('running');
    expect(getIssuePause(ISSUE)).toEqual({ status: 'unpaused' });
    expect(readPipelineJournal(workspace).at(-1)?.type).toBe('review.dispatched');
  });
});

describe('machine pauses and the stalled-review hold', () => {
  it('a machine pause of the work agent does not hold stalled-review recovery', async () => {
    seedConvoy();
    await Effect.runPromise(setAgentPaused(WORK, 'migrated to remote (fly.io)'));
    journalReviewDispatched(30);

    const actions = await recoverStalledReviews(Date.now());

    expect(mocks.recoverMissingConvoyReviewers).toHaveBeenCalledWith(ISSUE, { source: 'deacon-lite' });
    expect(actions).toHaveLength(1);
  });
});

describe('messageAgent while the issue is paused', () => {
  it('queues a message to a stopped reviewer instead of resuming it', async () => {
    seed(WORK, { role: 'work', paused: true, pausedBy: 'operator', pausedAt: '2026-09-24T10:00:00.000Z' });
    seed(PARENT, { status: 'stopped' });

    const outcome = await messageAgent(PARENT, 'REVIEWER_FAILED security reviewer exited');

    expect(outcome).toMatchObject({ delivered: false, queuedToMail: true });
    expect(outcome.reason).toContain('PAN-3911 is paused');
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
  });
});
