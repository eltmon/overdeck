import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { Effect } from 'effect';
import type { AgentState } from '../../agents.js';
import type { StuckRemediationState } from '../stuck-remediation-state.js';

const mocks = vi.hoisted(() => ({
  getAgentRuntimeStateSync: vi.fn(),
  listRunningAgentsSync: vi.fn(),
  markAgentTroubled: vi.fn(),
  messageAgent: vi.fn(),
  resumeAgent: vi.fn(),
  logDeaconEventSync: vi.fn(),
  getReviewStatusSync: vi.fn(),
  sessionExistsSync: vi.fn(),
  loadCloisterConfigSync: vi.fn(),
  isAgentIdleForNudge: vi.fn(),
  getAgentEffectiveLastActivityMs: vi.fn(),
  clearStuckRemediationState: vi.fn(),
  readStuckRemediationState: vi.fn(),
  writeStuckRemediationState: vi.fn(),
  pauseFlywheel: vi.fn(),
  resumeFlywheel: vi.fn(),
  listPaneValuesSync: vi.fn(),
  capturePaneSync: vi.fn(() => ''),
  detectTerminalApiErrorSync: vi.fn(() => null),
  killSessionSync: vi.fn(),
  getNoResumeMode: vi.fn(),
  getFlywheelActiveRunId: vi.fn(),
  isFlywheelGloballyPaused: vi.fn(),
  describeAgentDeath: vi.fn(),
  countPendingAskUserQuestionsForAgent: vi.fn(),
  recordRecoveryFailure: vi.fn(),
}));

vi.mock('../../agents.js', () => ({
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
  listRunningAgentsSync: mocks.listRunningAgentsSync,
  markAgentTroubled: mocks.markAgentTroubled,
  messageAgent: mocks.messageAgent,
  resumeAgent: mocks.resumeAgent,
}));

vi.mock('../../agent-enrichment.js', () => ({
  countPendingAskUserQuestionsForAgent: mocks.countPendingAskUserQuestionsForAgent,
}));

vi.mock('../../persistent-logger.js', () => ({
  logDeaconEventSync: mocks.logDeaconEventSync,
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
}));

vi.mock('../../tmux.js', () => ({
  sessionExistsSync: mocks.sessionExistsSync,
  listPaneValuesSync: mocks.listPaneValuesSync,
  killSessionSync: mocks.killSessionSync,
  capturePaneSync: mocks.capturePaneSync,
  detectTerminalApiErrorSync: mocks.detectTerminalApiErrorSync,
}));

vi.mock('../config.js', () => ({
  DEFAULT_CLOISTER_CONFIG: {
    stuck_remediation: {
      enabled: true,
      stage1_minutes: 20,
      stage2_minutes: 45,
      stage3_minutes: 90,
      flywheel_stage1_minutes: 20,
      flywheel_stage2_minutes: 24,
      flywheel_stage3_minutes: 28,
    },
  },
  loadCloisterConfigSync: mocks.loadCloisterConfigSync,
}));

vi.mock('../agent-idle.js', () => ({
  isAgentIdleForNudge: mocks.isAgentIdleForNudge,
  getAgentEffectiveLastActivityMs: mocks.getAgentEffectiveLastActivityMs,
}));

vi.mock('../stuck-remediation-state.js', () => ({
  clearStuckRemediationState: mocks.clearStuckRemediationState,
  readStuckRemediationState: mocks.readStuckRemediationState,
  writeStuckRemediationState: mocks.writeStuckRemediationState,
}));

vi.mock('../flywheel.js', () => ({
  pauseFlywheel: mocks.pauseFlywheel,
  resumeFlywheel: mocks.resumeFlywheel,
  FLYWHEEL_ORCHESTRATOR_AGENT_ID: 'flywheel-orchestrator',
}));

vi.mock('../no-resume-mode.js', () => ({
  getNoResumeMode: mocks.getNoResumeMode,
}));

vi.mock('../../overdeck/control-settings.js', () => ({
  getFlywheelActiveRunId: mocks.getFlywheelActiveRunId,
  isFlywheelGloballyPaused: mocks.isFlywheelGloballyPaused,
}));

vi.mock('../agent-death.js', () => ({
  describeAgentDeath: mocks.describeAgentDeath,
}));

vi.mock('../../beads-query.js', () => ({
  resolveBeadsQueryRoot: vi.fn((workspacePath: string) => {
    const parts = workspacePath.split('/');
    const workspaceName = parts.at(-1) ?? '';
    const parent = parts.at(-2) ?? '';
    return workspaceName.startsWith('feature-') && parent === 'workspaces'
      ? parts.slice(0, -2).join('/') || '/'
      : workspacePath;
  }),
  queryReadyBeadsByIssueLabels: vi.fn((_workspace: string, issueIds: readonly string[]) =>
    Effect.succeed({
      byIssue: Object.fromEntries(issueIds.map((issueId) => [issueId.toLowerCase(), []])),
    }),
  ),
}));
vi.mock('../recovery-trip.js', () => ({ recordRecoveryFailure: mocks.recordRecoveryFailure }));

import { checkStuckAgentRemediation } from '../stuck-remediation.js';
import { queryReadyBeadsByIssueLabels } from '../../beads-query.js';

const NOW = Date.parse('2026-05-23T12:00:00.000Z');
const DEFAULT_CONFIG = {
  stuck_remediation: {
    enabled: true,
    stage1_minutes: 20,
    stage2_minutes: 45,
    stage3_minutes: 90,
    flywheel_stage1_minutes: 20,
    flywheel_stage2_minutes: 24,
    flywheel_stage3_minutes: 28,
  },
};

function lastActivity(idleMinutes: number): string {
  return new Date(NOW - idleMinutes * 60_000).toISOString();
}

function runtime(idleMinutes: number) {
  return {
    state: 'idle',
    lastActivity: lastActivity(idleMinutes),
  };
}

function agent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1415',
    issueId: 'PAN-1415',
    workspace: '/tmp/workspace-pan-1415',
    role: 'work',
    status: 'running',
    startedAt: '2026-05-23T10:00:00.000Z',
    tmuxActive: true,
    ...overrides,
  } as unknown as AgentState;
}

function state(lastStage: StuckRemediationState['lastStage'], idleMinutes: number): StuckRemediationState {
  return {
    lastStage,
    lastStageAt: new Date(NOW - 5 * 60_000).toISOString(),
    firstStuckAt: lastActivity(idleMinutes),
  };
}

const mockQueryReadyBeadsByIssueLabels = queryReadyBeadsByIssueLabels as any;

function mockReadyBeads(beads: Record<string, unknown[]> = {}): void {
  mockQueryReadyBeadsByIssueLabels.mockReturnValue(Effect.succeed({ byIssue: beads }));
}

function expectNoStage(): void {
  expect(mocks.messageAgent).not.toHaveBeenCalled();
  expect(mocks.resumeAgent).not.toHaveBeenCalled();
  expect(mocks.markAgentTroubled).not.toHaveBeenCalled();
  expect(mocks.writeStuckRemediationState).not.toHaveBeenCalled();
}

describe('checkStuckAgentRemediation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mocks.loadCloisterConfigSync.mockReturnValue(DEFAULT_CONFIG);
    mocks.capturePaneSync.mockReturnValue('');
    mocks.detectTerminalApiErrorSync.mockReturnValue(null);
    mocks.listRunningAgentsSync.mockReturnValue([agent()]);
    mocks.sessionExistsSync.mockReturnValue(true);
    mocks.getReviewStatusSync.mockReturnValue(null);
    mocks.isAgentIdleForNudge.mockReturnValue(true);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(25));
    mocks.getAgentEffectiveLastActivityMs.mockImplementation((agentId: string) => {
      const state = mocks.getAgentRuntimeStateSync(agentId);
      return state?.lastActivity ? new Date(state.lastActivity).getTime() : null;
    });
    mocks.readStuckRemediationState.mockReturnValue(null);
    mocks.messageAgent.mockResolvedValue(undefined);
    mocks.resumeAgent.mockResolvedValue({ success: true });
    mocks.listPaneValuesSync.mockReturnValue([]);
    mocks.getNoResumeMode.mockReturnValue({ active: false, since: null });
    mocks.getFlywheelActiveRunId.mockReturnValue('RUN-8');
    mocks.resumeFlywheel.mockResolvedValue({ activeRunId: 'RUN-8' });
    mocks.describeAgentDeath.mockReturnValue('exit=1 at 2026-05-23T11:59:00Z');
    mocks.countPendingAskUserQuestionsForAgent.mockReturnValue(Effect.succeed(0));
    mocks.recordRecoveryFailure.mockReturnValue({ trip: { tripCount: 1 }, emitNeedsYou: true });
    mockReadyBeads();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not fire a stage when the agent has only been idle for 5 minutes', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(5));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expectNoStage();
    expect(mocks.logDeaconEventSync).not.toHaveBeenCalled();
  });

  it('fires stage 1 for a 25-minute idle agent with no prior state', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(25));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    const expectedAction = '[deacon] stuck-remediation stage=1 issue=PAN-1415 idleMin=25 action=poked';
    expect(actions).toEqual([expectedAction]);
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-pan-1415',
      expect.stringContaining('no tool calls for 25 min'),
    );
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-pan-1415',
      expect.stringContaining('pan done PAN-1415'),
    );
    expect(mocks.writeStuckRemediationState).toHaveBeenCalledWith('agent-pan-1415', {
      lastStage: 1,
      lastStageAt: new Date(NOW).toISOString(),
      firstStuckAt: lastActivity(25),
    });
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(expectedAction);
  });

  it('parks a terminal provider failure without sending another nudge', async () => {
    mocks.capturePaneSync.mockReturnValue("API Error: 402 We're unable to verify your membership benefits");
    mocks.detectTerminalApiErrorSync.mockReturnValue({
      kind: 'permission_denied',
      summary: 'Provider rejected request (402 account or membership required)',
      raw: 'API Error: 402',
    });

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toContain('agent-pan-1415 provider-terminal: Provider rejected request (402 account or membership required)');
    expect(mocks.markAgentTroubled).toHaveBeenCalledWith('agent-pan-1415');
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
  });

  it('fires stage 2 for a 50-minute idle agent with prior stage 1 state', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(50));
    mocks.readStuckRemediationState.mockReturnValue(state(1, 50));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    const expectedAction = '[deacon] stuck-remediation stage=2 issue=PAN-1415 idleMin=50 action=resumed';
    expect(actions).toEqual([expectedAction]);
    expect(mocks.resumeAgent).toHaveBeenCalledWith(
      'agent-pan-1415',
      expect.stringContaining('auto-detected stall (50 min idle)'),
    );
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.writeStuckRemediationState).toHaveBeenCalledWith('agent-pan-1415', {
      lastStage: 2,
      lastStageAt: new Date(NOW).toISOString(),
      firstStuckAt: lastActivity(50),
    });
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(expectedAction);
  });

  it('does not advance stage 2 state when resume fails', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(50));
    mocks.readStuckRemediationState.mockReturnValue(state(1, 50));
    mocks.resumeAgent.mockResolvedValue({ success: false });

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expect(mocks.resumeAgent).toHaveBeenCalledOnce();
    expect(mocks.writeStuckRemediationState).not.toHaveBeenCalled();
    // PAN-2108: resume-failed now carries the death reason (exit code + tail).
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(
      '[deacon] stuck-remediation stage=2 issue=PAN-1415 idleMin=50 action=resume-failed — death: exit=1 at 2026-05-23T11:59:00Z',
    );
  });

  it('fires stage 3 for a 100-minute idle agent with prior stage 2 state', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(100));
    mocks.readStuckRemediationState.mockReturnValue(state(2, 100));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    const expectedAction = '[deacon] stuck-remediation stage=3 issue=PAN-1415 idleMin=100 action=marked-troubled';
    expect(actions).toEqual([expectedAction, '[deacon] needs-you PAN-1415: stuck remediation exhausted']);
    expect(mocks.markAgentTroubled).toHaveBeenCalledWith('agent-pan-1415');
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
    expect(mocks.writeStuckRemediationState).toHaveBeenCalledWith('agent-pan-1415', {
      lastStage: 3,
      lastStageAt: new Date(NOW).toISOString(),
      firstStuckAt: lastActivity(100),
    });
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(expectedAction);
  });

  it('does not take further action for prior stage 3 state', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(30));
    mocks.readStuckRemediationState.mockReturnValue(state(3, 30));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expectNoStage();
    expect(mocks.logDeaconEventSync).not.toHaveBeenCalled();
  });

  it('clears remediation state when the agent became active after firstStuckAt', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(30));
    mocks.readStuckRemediationState.mockReturnValue({
      lastStage: 2,
      lastStageAt: new Date(NOW - 10 * 60_000).toISOString(),
      firstStuckAt: lastActivity(60),
    });

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expect(mocks.clearStuckRemediationState).toHaveBeenCalledWith('agent-pan-1415');
    expectNoStage();
  });

  // PAN-2519: operator-owned / already-done review states are never auto-acted.
  // (Rework states — blocked/failed/verification-failed — are handled below by
  // the wedged-rework kill-for-respawn branch, NOT skipped.)
  it.each([
    ['stuck review status', { stuck: true }],
    ['deacon ignored review status', { deaconIgnored: true }],
    ['merged review status', { mergeStatus: 'merged' }],
    ['ready-for-merge review status', { readyForMerge: true }],
  ])('skips agents with %s', async (_name, reviewStatus) => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(100));
    mocks.getReviewStatusSync.mockReturnValue(reviewStatus);

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expectNoStage();
    expect(mocks.killSessionSync).not.toHaveBeenCalled();
    expect(mockQueryReadyBeadsByIssueLabels).not.toHaveBeenCalled();
  });

  // PAN-2519: a wedged-but-alive work agent that OWES a rework fix is invisible to
  // both idle-escalation (skipped via shouldSkipReviewStatus) and PAN-2209 respawn
  // (its session still exists), so it stalls. Kill the session so the deacon's
  // dead-end path respawns a fresh agent that drains .pan/feedback.
  it.each([
    ['blocked review status', { reviewStatus: 'blocked' }],
    ['failed review status', { reviewStatus: 'failed' }],
    ['failed verification status', { verificationStatus: 'failed' }],
    ['failed test status', { testStatus: 'failed' }],
  ])('kills a wedged rework agent for respawn with %s', async (_name, reviewStatus) => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(100));
    mocks.getReviewStatusSync.mockReturnValue(reviewStatus);

    const actions = await checkStuckAgentRemediation({ now: NOW });

    const expectedAction = '[deacon] stuck-remediation stage=3 issue=PAN-1415 idleMin=100 action=killed-for-respawn';
    expect(actions).toEqual([expectedAction]);
    expect(mocks.killSessionSync).toHaveBeenCalledWith('agent-pan-1415');
    expect(mocks.markAgentTroubled).not.toHaveBeenCalled();
    expect(mocks.writeStuckRemediationState).toHaveBeenCalledWith('agent-pan-1415', {
      lastStage: 3,
      lastStageAt: new Date(NOW).toISOString(),
      firstStuckAt: lastActivity(100),
    });
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(expectedAction);
  });

  it('does not kill a wedged rework agent below the stage-3 idle threshold', async () => {
    // 50 min idle (< stage3_minutes=90) — still within the poke/resume ladder.
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(50));
    mocks.getReviewStatusSync.mockReturnValue({ reviewStatus: 'blocked' });

    await checkStuckAgentRemediation({ now: NOW });

    expect(mocks.killSessionSync).not.toHaveBeenCalled();
  });

  it('parks a chronically re-dying rework agent as troubled once the requeue ceiling is hit', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(100));
    // autoRequeueCount >= 25 mirrors the deacon dead-end breaker: respawn would be
    // refused, so park as troubled to leave a live operator signal, not a dead session.
    mocks.getReviewStatusSync.mockReturnValue({ reviewStatus: 'blocked', autoRequeueCount: 25 });

    const actions = await checkStuckAgentRemediation({ now: NOW });

    const expectedAction = '[deacon] stuck-remediation stage=3 issue=PAN-1415 idleMin=100 action=rework-wedge-troubled';
    expect(actions).toEqual([expectedAction, '[deacon] needs-you PAN-1415: stuck remediation exhausted']);
    expect(mocks.killSessionSync).not.toHaveBeenCalled();
    expect(mocks.markAgentTroubled).toHaveBeenCalledWith('agent-pan-1415');
  });

  it('skips agents with open ready beads', async () => {
    mockReadyBeads({
      'pan-1415': [{ id: 'workspace-zkug', title: 'PAN-1415: remaining task', status: 'open', labels: ['pan-1415'] }],
    });
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(100));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expectNoStage();
    expect(mocks.readStuckRemediationState).not.toHaveBeenCalled();
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
  });

  it.each([
    ['paused', { paused: true }],
    ['troubled', { troubled: true }],
  ])('skips %s agents', async (_name, agentState) => {
    mocks.listRunningAgentsSync.mockReturnValue([agent(agentState)]);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(100));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expectNoStage();
    expect(mocks.getReviewStatusSync).not.toHaveBeenCalled();
    expect(mockQueryReadyBeadsByIssueLabels).not.toHaveBeenCalled();
  });

  it('skips all agents when stuck remediation is disabled', async () => {
    mocks.loadCloisterConfigSync.mockReturnValue({
      stuck_remediation: {
        ...DEFAULT_CONFIG.stuck_remediation,
        enabled: false,
      },
    });

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expect(mocks.listRunningAgentsSync).not.toHaveBeenCalled();
    expectNoStage();
  });

  it('skips agents that are not idle according to the shared idle gate', async () => {
    mocks.isAgentIdleForNudge.mockReturnValue(false);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(100));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expectNoStage();
    expect(mocks.getAgentRuntimeStateSync).not.toHaveBeenCalled();
    expect(mockQueryReadyBeadsByIssueLabels).not.toHaveBeenCalled();
  });

  it('continues processing other agents when one agent throws during stage handling', async () => {
    mocks.listRunningAgentsSync.mockReturnValue([
      agent({ id: 'agent-pan-1415', issueId: 'PAN-1415' }),
      agent({ id: 'agent-pan-1416', issueId: 'PAN-1416' }),
    ]);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(25));
    mocks.messageAgent
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValueOnce(undefined);

    const actions = await checkStuckAgentRemediation({ now: NOW });

    const expectedAction = '[deacon] stuck-remediation stage=1 issue=PAN-1416 idleMin=25 action=poked';
    expect(actions).toEqual([expectedAction]);
    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.writeStuckRemediationState).toHaveBeenCalledOnce();
    expect(mocks.writeStuckRemediationState).toHaveBeenCalledWith('agent-pan-1416', {
      lastStage: 1,
      lastStageAt: new Date(NOW).toISOString(),
      firstStuckAt: lastActivity(25),
    });
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(
      '[deacon] stuck-remediation agent=agent-pan-1415 error=send failed',
    );
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(expectedAction);
  });

  it('queries ready beads once for work agents across one project fleet', async () => {
    mocks.listRunningAgentsSync.mockReturnValue([
      agent({
        id: 'agent-pan-1415',
        issueId: 'PAN-1415',
        workspace: '/tmp/project/workspaces/feature-pan-1415',
      }),
      agent({
        id: 'agent-pan-1416',
        issueId: 'PAN-1416',
        workspace: '/tmp/project/workspaces/feature-pan-1416',
      }),
    ]);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(25));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([
      '[deacon] stuck-remediation stage=1 issue=PAN-1415 idleMin=25 action=poked',
      '[deacon] stuck-remediation stage=1 issue=PAN-1416 idleMin=25 action=poked',
    ]);
    expect(mockQueryReadyBeadsByIssueLabels).toHaveBeenCalledTimes(1);
    expect(mockQueryReadyBeadsByIssueLabels).toHaveBeenCalledWith(
      '/tmp/project',
      ['PAN-1415', 'PAN-1416'],
      { acquisitionTimeoutMs: 500 },
    );
  });

  it('auto-advances an idle auto-planning agent with a pending question', async () => {
    mocks.listRunningAgentsSync.mockReturnValue([
      agent({
        id: 'planning-pan-2158',
        issueId: 'PAN-2158',
        role: 'plan',
        auto: true,
      }),
    ]);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(25));
    mocks.countPendingAskUserQuestionsForAgent.mockReturnValue(Effect.succeed(1));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    const expectedAction = '[deacon] stuck-remediation stage=1 issue=PAN-2158 idleMin=25 action=auto-planning-default';
    expect(actions).toEqual([expectedAction]);
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'planning-pan-2158',
      expect.stringContaining('pan plan PAN-2158 --auto'),
    );
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'planning-pan-2158',
      expect.stringContaining('plan.autoDecisions[]'),
    );
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
    expect(mocks.markAgentTroubled).not.toHaveBeenCalled();
    expect(mocks.writeStuckRemediationState).toHaveBeenCalledWith('planning-pan-2158', {
      lastStage: 1,
      lastStageAt: new Date(NOW).toISOString(),
      firstStuckAt: lastActivity(25),
    });
    expect(mocks.logDeaconEventSync).toHaveBeenCalledWith(expectedAction);
  });

  it('does not auto-advance interactive planning agents', async () => {
    mocks.listRunningAgentsSync.mockReturnValue([
      agent({
        id: 'planning-pan-2158',
        issueId: 'PAN-2158',
        role: 'plan',
        auto: false,
      }),
    ]);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(25));
    mocks.countPendingAskUserQuestionsForAgent.mockReturnValue(Effect.succeed(1));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expectNoStage();
    expect(mocks.countPendingAskUserQuestionsForAgent).not.toHaveBeenCalled();
  });
});

describe('checkStuckAgentRemediation — flywheel orchestrator coverage', () => {
  // Singleton flywheel orchestrator with role='flywheel' was previously
  // excluded by the role !== 'work' filter, so a stuck orchestrator (e.g.
  // a model call hanging on a tick) was never poked, paused, or marked
  // troubled. Coverage added 2026-05-23.
  function flywheelAgent(overrides: Partial<AgentState> = {}): AgentState {
    return {
      id: 'flywheel-orchestrator',
      issueId: '',
      workspace: '/home/eltmon/Projects/overdeck',
      role: 'flywheel',
      status: 'running',
      startedAt: '2026-05-23T10:00:00.000Z',
      tmuxActive: true,
      ...overrides,
    } as unknown as AgentState;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mocks.loadCloisterConfigSync.mockReturnValue(DEFAULT_CONFIG);
    mocks.listRunningAgentsSync.mockReturnValue([flywheelAgent()]);
    mocks.sessionExistsSync.mockReturnValue(true);
    mocks.isAgentIdleForNudge.mockReturnValue(true);
    mocks.readStuckRemediationState.mockReturnValue(null);
    mocks.messageAgent.mockResolvedValue(undefined);
    mocks.pauseFlywheel.mockResolvedValue({ activeRunId: 'RUN-8' });
    // PAN-2108 defaults: orchestrator alive (no dead pane), run active, resume OK.
    mocks.listPaneValuesSync.mockReturnValue([]);
    mocks.getNoResumeMode.mockReturnValue({ active: false, since: null });
    mocks.getFlywheelActiveRunId.mockReturnValue('RUN-8');
    mocks.isFlywheelGloballyPaused.mockReturnValue(false);
    mocks.resumeFlywheel.mockResolvedValue({ activeRunId: 'RUN-8' });
    mocks.describeAgentDeath.mockReturnValue('exit=1 at 2026-05-23T11:59:00Z');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([16, 17])('does not fire a flywheel stage inside the healthy 1000s self-wake window at %i min idle', async (idleMinutes) => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(idleMinutes));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.resumeFlywheel).not.toHaveBeenCalled();
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
  });

  it('pokes the orchestrator (stage 1) at 20 min idle with a full-tick nudge', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(20));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    const expectedAction = '[deacon] stuck-remediation stage=1 issue=FLYWHEEL idleMin=20 action=poked';
    expect(actions).toEqual([expectedAction]);
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      expect.stringContaining('FULL flywheel tick NOW: inventory -> diagnose -> suggest -> launch ready work'),
    );
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      expect.stringContaining('ScheduleWakeup(delaySeconds:1000)'),
    );
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      expect.stringContaining('Do NOT ask the operator a question'),
    );
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
    expect(mocks.markAgentTroubled).not.toHaveBeenCalled();
    // bd ready / review-status guards are work-agent-only and must NOT fire
    // for the flywheel (no beads, no issueId).
    expect(mockQueryReadyBeadsByIssueLabels).not.toHaveBeenCalled();
    expect(mocks.getReviewStatusSync).not.toHaveBeenCalled();
  });

  it('escalates to stage 2 nudge at 24 min idle (no resumeAgent for flywheel)', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(24));
    mocks.readStuckRemediationState.mockReturnValue(state(1, 24));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual(['[deacon] stuck-remediation stage=2 issue=FLYWHEEL idleMin=24 action=escalated-nudge']);
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      expect.stringContaining('Stage 2'),
    );
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      expect.stringContaining('FULL flywheel tick NOW: inventory -> diagnose -> suggest -> launch ready work'),
    );
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      expect.stringContaining('ScheduleWakeup(delaySeconds:1000)'),
    );
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
  });

  it('fresh-launches a wedged orchestrator at flywheel stage 3 (28 min idle)', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(28));
    mocks.readStuckRemediationState.mockReturnValue(state(2, 28));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([
      '[deacon] FLYWHEEL orchestrator wedged (idle 28min) — fresh-launched (relaunch 1/3)',
    ]);
    expect(mocks.killSessionSync).toHaveBeenCalledWith('flywheel-orchestrator');
    expect(mocks.resumeFlywheel).toHaveBeenCalledOnce();
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
    expect(mocks.markAgentTroubled).not.toHaveBeenCalled();
  });

  it('skips when the orchestrator is already paused (no re-pause loop)', async () => {
    mocks.listRunningAgentsSync.mockReturnValue([flywheelAgent({ paused: true } as Partial<AgentState>)]);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(120));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
    expect(mocks.messageAgent).not.toHaveBeenCalled();
  });

  // PAN-2108: a DEAD orchestrator process (not idle) must self-heal — kill the
  // zombie session and fresh-launch the run — so the pipeline's last stand
  // survives a silent omp death like RUN-30.
  it('fresh-launches the orchestrator when its omp pane is dead', async () => {
    mocks.sessionExistsSync.mockReturnValue(true);
    mocks.listPaneValuesSync.mockReturnValue(['1']); // #{pane_dead} = 1
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(25));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(mocks.killSessionSync).toHaveBeenCalledWith('flywheel-orchestrator');
    expect(mocks.resumeFlywheel).toHaveBeenCalledOnce();
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
    expect(mocks.writeStuckRemediationState).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      expect.objectContaining({ respawnCount: 1 }),
    );
    expect(actions[0]).toContain('fresh-launched (relaunch 1/3)');
  });

  it('fresh-launches the orchestrator when its session has fully vanished', async () => {
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(95));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(mocks.resumeFlywheel).toHaveBeenCalledOnce();
    expect(actions[0]).toContain('fresh-launched');
  });

  it('auto-relaunches a dead orchestrator even under OVERDECK_NO_RESUME', async () => {
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.getNoResumeMode.mockReturnValue({ active: true, since: 'x' });

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(mocks.resumeFlywheel).toHaveBeenCalledOnce();
    expect(actions).toEqual([
      '[deacon] FLYWHEEL orchestrator DIED (exit=1 at 2026-05-23T11:59:00Z) — fresh-launched (relaunch 1/3)',
    ]);
    expect(actions[0]).not.toContain('not auto-relaunching');
  });

  it('does not resurrect when there is no active flywheel run (operator stopped it)', async () => {
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.getFlywheelActiveRunId.mockReturnValue(null);

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(mocks.resumeFlywheel).not.toHaveBeenCalled();
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('fresh-launches when the active run gate is set but the orchestrator is no longer listed running', async () => {
    mocks.listRunningAgentsSync.mockReturnValue([]);
    mocks.sessionExistsSync.mockReturnValue(false);

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(mocks.killSessionSync).toHaveBeenCalledWith('flywheel-orchestrator');
    expect(mocks.resumeFlywheel).toHaveBeenCalledOnce();
    expect(actions).toEqual([
      '[deacon] FLYWHEEL orchestrator DIED (exit=1 at 2026-05-23T11:59:00Z) — fresh-launched (relaunch 1/3)',
    ]);
  });

  it('does not resurrect a missing orchestrator while the active run is paused', async () => {
    mocks.listRunningAgentsSync.mockReturnValue([]);
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.isFlywheelGloballyPaused.mockReturnValue(true);

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(mocks.resumeFlywheel).not.toHaveBeenCalled();
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it('escalates to pause+troubled after exceeding the relaunch cap (crash loop)', async () => {
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.readStuckRemediationState.mockReturnValue({
      lastStage: 0,
      lastStageAt: new Date(NOW - 60_000).toISOString(),
      firstStuckAt: new Date(NOW - 60_000).toISOString(),
      respawnCount: 3,
      lastRespawnAt: new Date(NOW - 60_000).toISOString(),
    } as StuckRemediationState);

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(mocks.resumeFlywheel).not.toHaveBeenCalled();
    expect(mocks.pauseFlywheel).toHaveBeenCalledOnce();
    expect(mocks.markAgentTroubled).toHaveBeenCalledWith('flywheel-orchestrator');
    expect(actions[0]).toContain('exceeded 3 relaunches');
  });
});
