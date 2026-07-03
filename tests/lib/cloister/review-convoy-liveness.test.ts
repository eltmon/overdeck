import { Effect } from 'effect';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const agentStates = new Map<string, { status?: string; paused?: boolean; troubled?: boolean }>();
  return {
    agentStates,
    getAgentStateSync: vi.fn((agentId: string) => agentStates.get(agentId) ?? null),
    loadReviewStatuses: vi.fn().mockReturnValue({}),
    setReviewStatusSync: vi.fn(),
    resolveProjectFromIssueSync: vi.fn().mockReturnValue({ projectKey: 'overdeck', projectPath: '/repo' }),
    findWorkspacePath: vi.fn().mockReturnValue('/workspace'),
    emitActivityEntrySync: vi.fn(),
    spawnRun: vi.fn(),
    killSessionSync: vi.fn(),
    killSession: vi.fn(),
    spawnReviewRoleForIssue: vi.fn(),
    tryReserveAdvancingSlot: vi.fn(() => true),
  };
});

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: vi.fn().mockReturnValue(null),
  loadReviewStatuses: (...args: unknown[]) => mocks.loadReviewStatuses(...args),
  setReviewStatusSync: (...args: unknown[]) => mocks.setReviewStatusSync(...args),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentRuntimeStateSync: vi.fn().mockReturnValue(null),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgentsSync: vi.fn().mockReturnValue([]),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentStateSync: (...args: [string]) => mocks.getAgentStateSync(...args),
  getAgentState: vi.fn().mockReturnValue(null),
  saveAgentStateSync: vi.fn(),
  saveAgentState: vi.fn(),
  resumeAgent: vi.fn(),
  recordAgentFailure: vi.fn(),
  markAgentRunningState: vi.fn(),
  spawnRun: (...args: unknown[]) => mocks.spawnRun(...args),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: (...args: unknown[]) => mocks.resolveProjectFromIssueSync(...args),
  listProjectsSync: vi.fn().mockReturnValue([]),
  getProjectSync: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../src/lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: (...args: unknown[]) => mocks.findWorkspacePath(...args),
}));

vi.mock('../../../src/lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    buildTmuxCommandString: vi.fn(),
    capturePane: vi.fn(() => Effect.succeed('')),
    createSession: vi.fn(() => Effect.succeed(undefined)),
    isPaneDead: vi.fn(() => Effect.succeed(false)),
    killSessionSync: (...args: unknown[]) => mocks.killSessionSync(...args),
    killSession: (...args: unknown[]) => {
      mocks.killSession(...args);
      return Effect.succeed(undefined);
    },
    listPaneValuesSync: vi.fn().mockReturnValue([]),
    listPaneValues: vi.fn(() => Effect.succeed([])),
    listSessionNames: vi.fn(() => Effect.succeed([])),
    sessionExistsSync: vi.fn().mockReturnValue(false),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    sendKeys: vi.fn(() => Effect.succeed(undefined)),
  };
});

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  SpecialistAgentName: {},
  getTmuxSessionName: vi.fn(),
  isRunning: vi.fn().mockResolvedValue(false),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: (...args: unknown[]) => mocks.emitActivityEntrySync(...args),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../src/lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: (...args: unknown[]) => mocks.spawnReviewRoleForIssue(...args),
}));

// PAN-1665: permissive concurrency governor — these tests assert the dispatch
// logic itself, not the slot budget, so allow a slot by default.
vi.mock('../../../src/lib/cloister/concurrency.js', () => ({
  resetPatrolDispatchBudget: () => {},
  tryReserveAdvancingSlot: (...args: unknown[]) => mocks.tryReserveAdvancingSlot(...args),
  releaseAdvancingSlot: vi.fn(),
  tryReserveSwarmSlot: () => true,
  releaseSwarmSlot: vi.fn(),
  canDispatchAdvancing: () => true,
  getConcurrencyLimits: () => ({ maxWorkAgents: 6, reservedAdvancingSlots: 3, totalCeiling: 9 }),
  countRunningAgents: () => ({ work: 0, advancing: 0, total: 0 }),
  workResumeSlotsAvailable: () => 6,
  describeRunningAgents: () => '0 work / 0 advancing',
}));

import {
  recoverStalledReviewConvoys,
  reviewConvoyLiveness,
  stalledReviewConvoyRecoveryState,
} from '../../../src/lib/cloister/deacon.js';

const convoyAgentIds = [
  'agent-pan-1614',
  'agent-pan-1614-review',
  'agent-pan-1614-review-security',
  'agent-pan-1614-review-correctness',
  'agent-pan-1614-review-performance',
  'agent-pan-1614-review-requirements',
];

const stalledStatus = {
  issueId: 'PAN-1614',
  reviewStatus: 'pending' as const,
  testStatus: 'pending' as const,
  updatedAt: '2026-06-05T00:00:00.000Z',
  readyForMerge: false,
};

const cooldownMs = 15 * 60 * 1000;

function setStatuses(statuses: Record<string, unknown>): void {
  mocks.loadReviewStatuses.mockReturnValue(statuses);
}

describe('reviewConvoyLiveness', () => {
  beforeEach(() => {
    mocks.agentStates.clear();
    mocks.getAgentStateSync.mockClear();
    mocks.setReviewStatusSync.mockClear();
    mocks.spawnRun.mockClear();
    mocks.killSessionSync.mockClear();
    mocks.killSession.mockClear();
    mocks.spawnReviewRoleForIssue.mockClear();
  });

  it('enumerates the work, synthesis, and reviewer sub-role agent ids from REVIEW_SUB_ROLES', () => {
    const result = reviewConvoyLiveness('PAN-1614');

    expect(result.agentIds).toEqual(convoyAgentIds);
    expect(mocks.getAgentStateSync.mock.calls.map(([agentId]) => agentId)).toEqual(convoyAgentIds);
  });

  it('reports all stopped agents as not live and not gated', () => {
    for (const agentId of convoyAgentIds) {
      mocks.agentStates.set(agentId, { status: 'stopped' });
    }

    expect(reviewConvoyLiveness('PAN-1614')).toEqual({
      anyLive: false,
      anyGated: false,
      agentIds: convoyAgentIds,
    });
  });

  it('reports a running sub-role reviewer as live', () => {
    mocks.agentStates.set('agent-pan-1614-review-performance', { status: 'running' });

    const result = reviewConvoyLiveness('PAN-1614');

    expect(result.anyLive).toBe(true);
    expect(result.anyGated).toBe(false);
  });

  it('reports a paused work agent as gated', () => {
    mocks.agentStates.set('agent-pan-1614', { status: 'stopped', paused: true });

    const result = reviewConvoyLiveness('PAN-1614');

    expect(result.anyLive).toBe(false);
    expect(result.anyGated).toBe(true);
  });

  it('reports a troubled sub-role reviewer as gated', () => {
    mocks.agentStates.set('agent-pan-1614-review-security', { status: 'stopped', troubled: true });

    const result = reviewConvoyLiveness('PAN-1614');

    expect(result.anyLive).toBe(false);
    expect(result.anyGated).toBe(true);
  });

  it('treats absent state files as stopped and ungated', () => {
    expect(reviewConvoyLiveness('PAN-1614')).toEqual({
      anyLive: false,
      anyGated: false,
      agentIds: convoyAgentIds,
    });
  });

  it('does not mutate review state, spawn agents, or kill tmux sessions', () => {
    reviewConvoyLiveness('PAN-1614');

    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
    expect(mocks.spawnRun).not.toHaveBeenCalled();
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
    expect(mocks.killSessionSync).not.toHaveBeenCalled();
    expect(mocks.killSession).not.toHaveBeenCalled();
  });
});

describe('recoverStalledReviewConvoys', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'));
    mocks.agentStates.clear();
    mocks.getAgentStateSync.mockClear();
    mocks.loadReviewStatuses.mockReset();
    mocks.setReviewStatusSync.mockClear();
    mocks.resolveProjectFromIssueSync.mockReset().mockReturnValue({ projectKey: 'overdeck', projectPath: '/repo' });
    mocks.findWorkspacePath.mockReset().mockReturnValue('/workspace');
    mocks.emitActivityEntrySync.mockClear();
    mocks.spawnRun.mockClear();
    mocks.killSessionSync.mockClear();
    mocks.killSession.mockClear();
    mocks.spawnReviewRoleForIssue.mockReset().mockReturnValue(Effect.succeed({ success: true, message: 'dispatched' }));
    mocks.tryReserveAdvancingSlot.mockReset().mockReturnValue(true);
    stalledReviewConvoyRecoveryState.clear();
    setStatuses({ 'PAN-1614': { ...stalledStatus } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('force re-dispatches a fully stopped in-review convoy', async () => {
    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalledTimes(1);
    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalledWith({
      issueId: 'PAN-1614',
      workspace: '/workspace',
      branch: 'feature/pan-1614',
      force: true,
    });
    expect(actions).toEqual(['Re-dispatched stalled review convoy for PAN-1614 (attempt 1/3)']);
  });

  it('does not re-dispatch when a convoy agent is live', async () => {
    mocks.agentStates.set('agent-pan-1614-review-correctness', { status: 'starting' });

    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(actions).toEqual([]);
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
  });

  it('does not re-dispatch when a convoy agent is paused or troubled', async () => {
    mocks.agentStates.set('agent-pan-1614', { status: 'stopped', paused: true });
    await recoverStalledReviewConvoys(async () => 'in_review');
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();

    mocks.agentStates.clear();
    mocks.agentStates.set('agent-pan-1614-review-requirements', { status: 'stopped', troubled: true });
    await recoverStalledReviewConvoys(async () => 'in_review');
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
  });

  it('filters out terminal, stuck, ignored, and non-in-review statuses before dispatch', async () => {
    setStatuses({
      'PAN-PASSED': { ...stalledStatus, issueId: 'PAN-PASSED', reviewStatus: 'passed' },
      'PAN-STUCK': { ...stalledStatus, issueId: 'PAN-STUCK', stuck: true },
      'PAN-IGNORED': { ...stalledStatus, issueId: 'PAN-IGNORED', deaconIgnored: true },
      'PAN-NOT-IN-REVIEW': { ...stalledStatus, issueId: 'PAN-NOT-IN-REVIEW' },
    });
    const getCanonicalState = vi.fn(async (issueId: string) => issueId === 'PAN-NOT-IN-REVIEW' ? 'verifying_on_main' : 'in_review');

    const actions = await recoverStalledReviewConvoys(getCanonicalState);

    expect(actions).toEqual([]);
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
    expect(getCanonicalState).toHaveBeenCalledTimes(1);
    expect(getCanonicalState).toHaveBeenCalledWith('PAN-NOT-IN-REVIEW');
  });

  it('defers within the cooldown after a failed attempt', async () => {
    mocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: false, message: 'spawn failed', error: 'spawn failed' }));

    await recoverStalledReviewConvoys(async () => 'in_review');
    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalledTimes(1);
    expect(actions).toEqual(['Stalled review convoy for PAN-1614: deferring — cooldown active after attempt 1/3']);
  });

  it('escalates exactly once after the attempt cap is reached', async () => {
    mocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: false, message: 'spawn failed', error: 'spawn failed' }));

    await recoverStalledReviewConvoys(async () => 'in_review');
    await vi.advanceTimersByTimeAsync(cooldownMs);
    await recoverStalledReviewConvoys(async () => 'in_review');
    await vi.advanceTimersByTimeAsync(cooldownMs);
    await recoverStalledReviewConvoys(async () => 'in_review');
    await vi.advanceTimersByTimeAsync(cooldownMs);

    const escalated = await recoverStalledReviewConvoys(async () => 'in_review');
    const repeated = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalledTimes(3);
    expect(mocks.emitActivityEntrySync).toHaveBeenCalledTimes(1);
    expect(mocks.setReviewStatusSync).toHaveBeenCalledTimes(1);
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-1614', expect.objectContaining({
      stuck: true,
      stuckReason: 'review_convoy_unrecoverable',
    }));
    expect(escalated).toEqual(['Stalled review convoy for PAN-1614: recovery cap reached after 3 attempts — marked stuck']);
    expect(repeated).toEqual([]);
  });

  it('clears recovery state after a successful re-dispatch', async () => {
    mocks.spawnReviewRoleForIssue.mockReturnValueOnce(Effect.succeed({ success: false, message: 'spawn failed', error: 'spawn failed' }));
    await recoverStalledReviewConvoys(async () => 'in_review');
    expect(stalledReviewConvoyRecoveryState.get('PAN-1614')?.attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(cooldownMs);
    mocks.spawnReviewRoleForIssue.mockReturnValueOnce(Effect.succeed({ success: true, message: 'dispatched' }));
    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(actions).toEqual(['Re-dispatched stalled review convoy for PAN-1614 (attempt 2/3)']);
    expect(stalledReviewConvoyRecoveryState.has('PAN-1614')).toBe(false);

    mocks.spawnReviewRoleForIssue.mockReturnValueOnce(Effect.succeed({ success: false, message: 'spawn failed', error: 'spawn failed' }));
    const nextActions = await recoverStalledReviewConvoys(async () => 'in_review');
    expect(nextActions).toEqual(['Failed to re-dispatch stalled review convoy for PAN-1614: spawn failed']);
    expect(stalledReviewConvoyRecoveryState.get('PAN-1614')?.attempts).toBe(1);
  });

  it('skips unresolvable projects and workspaces without consuming an attempt', async () => {
    mocks.resolveProjectFromIssueSync.mockReturnValueOnce(null);
    expect(await recoverStalledReviewConvoys(async () => 'in_review')).toEqual([
      'Skipped stalled review convoy recovery for PAN-1614: no project configured',
    ]);
    expect(stalledReviewConvoyRecoveryState.has('PAN-1614')).toBe(false);
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();

    mocks.resolveProjectFromIssueSync.mockReturnValueOnce({ projectKey: 'overdeck', projectPath: '/repo' });
    mocks.findWorkspacePath.mockReturnValueOnce(null);
    expect(await recoverStalledReviewConvoys(async () => 'in_review')).toEqual([
      'Skipped stalled review convoy recovery for PAN-1614: workspace unavailable',
    ]);
    expect(stalledReviewConvoyRecoveryState.has('PAN-1614')).toBe(false);
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
  });

  it('catches a single issue failure and still processes later candidates', async () => {
    setStatuses({
      'PAN-ERR': { ...stalledStatus, issueId: 'PAN-ERR' },
      'PAN-1614': { ...stalledStatus },
    });
    const getCanonicalState = vi.fn(async (issueId: string) => {
      if (issueId === 'PAN-ERR') throw new Error('canonical failed');
      return 'in_review';
    });

    const actions = await recoverStalledReviewConvoys(getCanonicalState);

    expect(actions).toEqual([
      'Failed stalled review convoy recovery for PAN-ERR: canonical failed',
      'Re-dispatched stalled review convoy for PAN-1614 (attempt 1/3)',
    ]);
    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalledTimes(1);
  });

  it('treats spawnReviewRoleForIssue success:false as a failed attempt without clearing recovery state', async () => {
    mocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: false, message: 'harness denied', error: 'harness denied' }));

    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(actions).toEqual(['Failed to re-dispatch stalled review convoy for PAN-1614: harness denied']);
    expect(stalledReviewConvoyRecoveryState.get('PAN-1614')?.attempts).toBe(1);
  });

  it('defers without consuming an attempt when the advancing-role ceiling is reached', async () => {
    mocks.tryReserveAdvancingSlot.mockReturnValue(false);

    const actions = await recoverStalledReviewConvoys(async () => 'in_review');

    expect(actions).toEqual(['Stalled review convoy for PAN-1614: deferring — advancing-role concurrency ceiling reached']);
    expect(mocks.spawnReviewRoleForIssue).not.toHaveBeenCalled();
    expect(stalledReviewConvoyRecoveryState.has('PAN-1614')).toBe(false);
  });

  it('grants a fresh attempt budget after a human unstick', async () => {
    mocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: false, message: 'spawn failed', error: 'spawn failed' }));

    await recoverStalledReviewConvoys(async () => 'in_review');
    await vi.advanceTimersByTimeAsync(cooldownMs);
    await recoverStalledReviewConvoys(async () => 'in_review');
    await vi.advanceTimersByTimeAsync(cooldownMs);
    await recoverStalledReviewConvoys(async () => 'in_review');
    await vi.advanceTimersByTimeAsync(cooldownMs);

    const escalated = await recoverStalledReviewConvoys(async () => 'in_review');
    expect(escalated).toEqual(['Stalled review convoy for PAN-1614: recovery cap reached after 3 attempts — marked stuck']);
    expect(stalledReviewConvoyRecoveryState.get('PAN-1614')?.escalated).toBe(true);

    // Human unsticks the issue.
    mocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'dispatched' }));
    setStatuses({ 'PAN-1614': { ...stalledStatus, stuck: false } });
    await vi.advanceTimersByTimeAsync(cooldownMs);

    const actions = await recoverStalledReviewConvoys(async () => 'in_review');
    expect(actions).toEqual(['Re-dispatched stalled review convoy for PAN-1614 (attempt 1/3)']);
    expect(stalledReviewConvoyRecoveryState.has('PAN-1614')).toBe(false);
  });
});
