import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import type { AgentState } from '../../agents.js';
import type { StuckRemediationState } from '../stuck-remediation-state.js';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
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
  clearStuckRemediationState: vi.fn(),
  readStuckRemediationState: vi.fn(),
  writeStuckRemediationState: vi.fn(),
  pauseFlywheel: vi.fn(),
  resumeFlywheel: vi.fn(),
  listPaneValuesSync: vi.fn(),
  killSessionSync: vi.fn(),
  getNoResumeMode: vi.fn(),
  getFlywheelActiveRunId: vi.fn(),
  describeAgentDeath: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mocks.execFile,
}));

vi.mock('../../agents.js', () => ({
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
  listRunningAgentsSync: mocks.listRunningAgentsSync,
  markAgentTroubled: mocks.markAgentTroubled,
  messageAgent: mocks.messageAgent,
  resumeAgent: mocks.resumeAgent,
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
}));

vi.mock('../config.js', () => ({
  DEFAULT_CLOISTER_CONFIG: {
    stuck_remediation: {
      enabled: true,
      stage1_minutes: 20,
      stage2_minutes: 45,
      stage3_minutes: 90,
    },
  },
  loadCloisterConfigSync: mocks.loadCloisterConfigSync,
}));

vi.mock('../agent-idle.js', () => ({
  isAgentIdleForNudge: mocks.isAgentIdleForNudge,
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
}));

vi.mock('../agent-death.js', () => ({
  describeAgentDeath: mocks.describeAgentDeath,
}));

import { checkStuckAgentRemediation } from '../stuck-remediation.js';

const NOW = Date.parse('2026-05-23T12:00:00.000Z');
const DEFAULT_CONFIG = {
  stuck_remediation: {
    enabled: true,
    stage1_minutes: 20,
    stage2_minutes: 45,
    stage3_minutes: 90,
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

function mockReadyBeads(stdout = ''): void {
  mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
    callback(null, { stdout, stderr: '' });
  });
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
    mocks.listRunningAgentsSync.mockReturnValue([agent()]);
    mocks.sessionExistsSync.mockReturnValue(true);
    mocks.getReviewStatusSync.mockReturnValue(null);
    mocks.isAgentIdleForNudge.mockReturnValue(true);
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(25));
    mocks.readStuckRemediationState.mockReturnValue(null);
    mocks.messageAgent.mockResolvedValue(undefined);
    mocks.resumeAgent.mockResolvedValue({ success: true });
    mocks.listPaneValuesSync.mockReturnValue([]);
    mocks.getNoResumeMode.mockReturnValue({ active: false, since: null });
    mocks.getFlywheelActiveRunId.mockReturnValue('RUN-8');
    mocks.resumeFlywheel.mockResolvedValue({ activeRunId: 'RUN-8' });
    mocks.describeAgentDeath.mockReturnValue('exit=1 at 2026-05-23T11:59:00Z');
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
    expect(actions).toEqual([expectedAction]);
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

  it.each([
    ['stuck review status', { stuck: true }],
    ['deacon ignored review status', { deaconIgnored: true }],
    ['blocked review status', { reviewStatus: 'blocked' }],
  ])('skips agents with %s', async (_name, reviewStatus) => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(100));
    mocks.getReviewStatusSync.mockReturnValue(reviewStatus);

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expectNoStage();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('skips agents with open ready beads', async () => {
    mockReadyBeads('○ workspace-zkug pan-1415: remaining task\n');
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(100));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual([]);
    expectNoStage();
    expect(mocks.readStuckRemediationState).not.toHaveBeenCalled();
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
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.getAgentRuntimeStateSync).not.toHaveBeenCalled();
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
    mocks.resumeFlywheel.mockResolvedValue({ activeRunId: 'RUN-8' });
    mocks.describeAgentDeath.mockReturnValue('exit=1 at 2026-05-23T11:59:00Z');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pokes the orchestrator (stage 1) at 25 min idle with a flywheel-specific nudge', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(25));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    const expectedAction = '[deacon] stuck-remediation stage=1 issue=FLYWHEEL idleMin=25 action=poked';
    expect(actions).toEqual([expectedAction]);
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      expect.stringContaining('Flywheel ticks should complete in under a minute'),
    );
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
    expect(mocks.markAgentTroubled).not.toHaveBeenCalled();
    // bd ready / review-status guards are work-agent-only and must NOT fire
    // for the flywheel (no beads, no issueId).
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.getReviewStatusSync).not.toHaveBeenCalled();
  });

  it('escalates to stage 2 nudge at 50 min idle (no resumeAgent for flywheel)', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(50));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual(['[deacon] stuck-remediation stage=2 issue=FLYWHEEL idleMin=50 action=escalated-nudge']);
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      expect.stringContaining('Stage 2'),
    );
    expect(mocks.resumeAgent).not.toHaveBeenCalled();
    expect(mocks.pauseFlywheel).not.toHaveBeenCalled();
  });

  it('pauses and marks troubled at stage 3 (95 min idle)', async () => {
    mocks.getAgentRuntimeStateSync.mockReturnValue(runtime(95));

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(actions).toEqual(['[deacon] stuck-remediation stage=3 issue=FLYWHEEL idleMin=95 action=paused-and-troubled']);
    expect(mocks.pauseFlywheel).toHaveBeenCalledOnce();
    expect(mocks.markAgentTroubled).toHaveBeenCalledWith('flywheel-orchestrator');
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

  it('does not auto-relaunch a dead orchestrator under OVERDECK_NO_RESUME', async () => {
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.getNoResumeMode.mockReturnValue({ active: true, since: 'x' });

    const actions = await checkStuckAgentRemediation({ now: NOW });

    expect(mocks.resumeFlywheel).not.toHaveBeenCalled();
    expect(actions[0]).toContain('OVERDECK_NO_RESUME=1, not auto-relaunching');
  });

  it('does not resurrect when there is no active flywheel run (operator stopped it)', async () => {
    mocks.sessionExistsSync.mockReturnValue(false);
    mocks.getFlywheelActiveRunId.mockReturnValue(null);

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
