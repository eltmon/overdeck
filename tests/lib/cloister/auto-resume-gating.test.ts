import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

const BASE_TIME = new Date('2026-05-17T12:00:00.000Z');

describe('auto-resume gates', () => {
  let tempHome: string;
  let projectRoot: string;
  let originalHome: string | undefined;
  let originalNoResume: string | undefined;
  let originalCwd: string;
  let resumeAgentMock: ReturnType<typeof vi.fn>;
  let bootReconciliationState: {
    decision: 'pending' | 'resume_all' | 'hold_all' | 'per_agent' | null;
    perAgent: Record<string, 'resume' | 'hold'>;
    decidedAt: string | null;
    bootId: string | null;
    graceDeadline: string | null;
  };
  // PAN-1665: free work slots the governor reports. High by default so the gating
  // tests below (1 candidate each) are unaffected; the cap test lowers it.
  let resumeSlotsMock: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    vi.resetModules();
    vi.clearAllMocks();

    tempHome = mkdtempSync(join(tmpdir(), 'pan-auto-resume-gating-'));
    projectRoot = join(tempHome, 'project');
    mkdirSync(join(projectRoot, 'workspaces', 'feature-pan-1141'), { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    originalNoResume = process.env.OVERDECK_NO_RESUME;
    originalCwd = process.cwd();
    process.env.OVERDECK_HOME = tempHome;
    delete process.env.OVERDECK_NO_RESUME;
    resumeAgentMock = vi.fn();
    resumeSlotsMock = 999;
    bootReconciliationState = {
      decision: null,
      perAgent: {},
      decidedAt: null,
      bootId: null,
      graceDeadline: null,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock('../../../src/lib/agents.js');
    vi.doUnmock('../../../src/lib/review-status.js');
    vi.doUnmock('../../../src/lib/shadow-state.js');
    vi.doUnmock('../../../src/lib/activity-logger.js');
    vi.doUnmock('../../../src/lib/persistent-logger.js');
    vi.doUnmock('../../../src/lib/database/app-settings.js');
    vi.doUnmock('../../../src/lib/overdeck/control-settings.js');
    vi.doUnmock('../../../src/lib/database/review-status-db.js');
    vi.doUnmock('../../../src/lib/cloister/specialists.js');
    vi.doUnmock('../../../src/lib/cloister/merge-agent.js');
    vi.doUnmock('../../../src/lib/projects.js');
    vi.doUnmock('../../../src/lib/work-agent-lifecycle.js');
    vi.doUnmock('../../../src/lib/cloister/work-agent-prompt.js');
    vi.doUnmock('../../../src/lib/prd-draft.js');
    vi.doUnmock('../../../src/lib/config.js');
    vi.doUnmock('../../../src/lib/tracker-utils.js');
    vi.doUnmock('../../../src/lib/shadow-mode.js');
    vi.doUnmock('../../../src/lib/remote/index.js');
    vi.doUnmock('../../../src/lib/remote/workspace-metadata.js');
    vi.doUnmock('../../../src/lib/operator-interventions.js');
    vi.doUnmock('../../../src/lib/tmux.js');
    vi.doUnmock('../../../src/lib/cloister/concurrency.js');
    vi.doUnmock('os');
    vi.doUnmock('child_process');
    vi.doUnmock('ora');
    vi.resetModules();

    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    if (originalNoResume === undefined) delete process.env.OVERDECK_NO_RESUME;
    else process.env.OVERDECK_NO_RESUME = originalNoResume;
    rmSync(tempHome, { recursive: true, force: true });
  });

  function workspaceFor(agentId: string): string {
    const workspace = join(tempHome, 'workspaces', agentId);
    mkdirSync(workspace, { recursive: true });
    return workspace;
  }

  async function loadDeaconWithResumeMock(osOverrides?: { loadavg?: number[]; cpusCount?: number }) {
    // PAN-1665: throttle tests need deterministic load/core counts. Default to
    // low load so unrelated auto-resume tests do not depend on the host machine.
    vi.doMock('os', async (importOriginal) => {
      const actual = await importOriginal<typeof import('os')>();
      const loadavg = osOverrides?.loadavg ?? [0, 0, 0];
      const cpusCount = osOverrides?.cpusCount ?? 4;
      return {
        ...actual,
        default: actual,
        loadavg: () => loadavg,
        cpus: () => Array.from({ length: cpusCount }, () => ({}) as ReturnType<typeof actual.cpus>[number]),
      };
    });
    vi.doMock('../../../src/lib/agents.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../src/lib/agents.js')>();
      return {
        ...actual,
        resumeAgent: (...args: unknown[]) => resumeAgentMock(...args),
        listRunningAgents: vi.fn(() => []),
        listRunningAgentsSync: vi.fn(() => []),
      };
    });
    // PAN-1665: deterministic concurrency budget — avoids reading the real machine's
    // cloister config / running-agent counts from inside the governor.
    vi.doMock('../../../src/lib/cloister/concurrency.js', () => ({
      getConcurrencyLimits: () => ({ maxWorkAgents: resumeSlotsMock, reservedAdvancingSlots: 3, totalCeiling: resumeSlotsMock + 3 }),
      countRunningAgents: () => ({ work: 0, advancing: 0, total: 0 }),
      workResumeSlotsAvailable: () => resumeSlotsMock,
      resetPatrolDispatchBudget: vi.fn(),
      tryReserveAdvancingSlot: () => true,
      canDispatchAdvancing: () => true,
    }));
    vi.doMock('../../../src/lib/review-status.js', () => ({
      getReviewStatus: vi.fn().mockReturnValue({
        reviewStatus: 'blocked',
        testStatus: 'pending',
        verificationStatus: 'passed',
        readyForMerge: false,
      }),
      getReviewStatusSync: vi.fn().mockReturnValue({
        reviewStatus: 'blocked',
        testStatus: 'pending',
        verificationStatus: 'passed',
        readyForMerge: false,
      }),
      loadReviewStatuses: vi.fn().mockReturnValue({}),
      setReviewStatus: vi.fn(),
      setReviewStatusSync: vi.fn(),
    }));
    vi.doMock('../../../src/lib/shadow-state.js', () => ({
      getShadowState: vi.fn(() => Effect.succeed(null)),
    }));
    // PAN-1613: autoResumeStoppedWorkAgents now gates on isIssueClosed. With
    // shadow-state mocked to null above, the real isIssueClosed would fall
    // through to a live `gh issue view` for the test issue ids — mock it so the
    // gate is deterministic (never closed) and the test stays hermetic.
    vi.doMock('../../../src/lib/cloister/issue-closed.js', () => ({
      isIssueClosed: vi.fn(async () => false),
      isTrackerIssueClosed: vi.fn(async () => false),
      clearIssueClosedCache: vi.fn(),
      TRACKER_CLOSED_CACHE_TTL_MS: 5 * 60 * 1000,
    }));
    vi.doMock('../../../src/lib/activity-logger.js', () => ({
      emitActivityEntry: vi.fn(),
      emitActivityEntrySync: vi.fn(),
      emitActivityTts: vi.fn(),
      emitActivityTtsSync: vi.fn(),
    }));
    vi.doMock('../../../src/lib/operator-interventions.js', () => ({
      appendOperatorInterventionEvent: vi.fn().mockResolvedValue(undefined),
      operatorInterventionEvent: vi.fn((input) => ({
        type: 'operator.intervention',
        timestamp: input.timestamp ?? BASE_TIME.toISOString(),
        payload: {
          issueId: input.issueId,
          kind: input.kind,
          source: input.source,
        },
      })),
    }));
    vi.doMock('../../../src/lib/persistent-logger.js', () => ({
      logDeaconEvent: vi.fn(),
      logDeaconEventSync: vi.fn(),
      logAgentLifecycle: vi.fn(),
      logAgentLifecycleSync: vi.fn(),
    }));
    vi.doMock('../../../src/lib/database/app-settings.js', () => ({
      isDeaconGloballyPaused: vi.fn().mockReturnValue(false),
    }));
    vi.doMock('../../../src/lib/overdeck/control-settings.js', () => ({
      isDeaconGloballyPaused: vi.fn().mockReturnValue(false),
      getBootReconciliationState: vi.fn(() => bootReconciliationState),
      setBootReconciliationDecision: vi.fn(),
      stampBootReconciliation: vi.fn(),
    }));
    vi.doMock('../../../src/lib/database/review-status-db.js', () => ({
      markWorkspaceStuck: vi.fn(),
    }));
    vi.doMock('../../../src/lib/cloister/specialists.js', () => ({
      getTmuxSessionName: vi.fn(),
      isRunning: vi.fn().mockResolvedValue(false),
      getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../../../src/lib/tmux.js', () => ({
      buildTmuxCommandString: vi.fn(),
      capturePaneAsync: vi.fn().mockResolvedValue(''),
      createSessionAsync: vi.fn(),
      isPaneDeadAsync: vi.fn().mockResolvedValue(false),
      killSession: vi.fn(),
      killSessionSync: vi.fn(),
      killSessionAsync: vi.fn().mockResolvedValue(undefined),
      listPaneValues: vi.fn().mockReturnValue([]),
      listPaneValuesAsync: vi.fn().mockResolvedValue([]),
      listSessionNamesAsync: vi.fn().mockResolvedValue([]),
      sessionExists: vi.fn(() => Effect.succeed(false)),
      sessionExistsSync: vi.fn().mockReturnValue(false),
      sessionExistsAsync: vi.fn().mockResolvedValue(false),
      sendKeysAsync: vi.fn().mockResolvedValue(undefined),
    }));

    const agents = await import('../../../src/lib/agents.js');
    const deacon = await import('../../../src/lib/cloister/deacon.js');
    return {
      agents,
      autoResumeStoppedWorkAgents: deacon.autoResumeStoppedWorkAgents,
      recoverOrphanedAgents: deacon.recoverOrphanedAgents,
    };
  }

  async function loadStartCommand() {
    vi.doMock('child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>();
      return {
        ...actual,
        exec: vi.fn(),
        execFile: vi.fn((file: string, args: string[], _options: unknown, callback: Function) => {
          if (file === 'bd' && args[0] === 'list') {
            callback(null, { stdout: '[{"id":"PAN-1141","labels":["pan-1141"]}]' }, '');
            return;
          }
          callback(null, { stdout: '' }, '');
        }),
        execFileSync: vi.fn(),
        execSync: vi.fn().mockReturnValue('feature/pan-1141\n'),
      };
    });
    vi.doMock('ora', () => ({
      default: vi.fn(() => ({
        start() { return this; },
        text: '',
        fail: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        succeed: vi.fn(),
      })),
    }));
    vi.doMock('../../../src/lib/agents.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../src/lib/agents.js')>();
      return {
        ...actual,
        spawnAgent: vi.fn(async () => ({ id: 'agent-pan-1141', issueId: 'PAN-1141', workspace: join(projectRoot, 'workspaces', 'feature-pan-1141'), model: 'm', startedAt: BASE_TIME.toISOString() })),
        getProviderAuthMode: vi.fn(async () => 'api'),
        getProviderEnvForModel: vi.fn(async () => ({})),
        getProviderExportsForModel: vi.fn(async () => ''),
        getAgentRuntimeBaseCommand: vi.fn(async () => 'claude'),
      };
    });
    vi.doMock('../../../src/lib/cloister/merge-agent.js', () => ({
      syncMainIntoWorkspace: vi.fn().mockResolvedValue({ success: true, alreadyUpToDate: true }),
    }));
    const resolvedProject = {
      projectKey: 'test',
      projectName: 'Test',
      projectPath: projectRoot,
    };
    const projects = [{ key: 'test', config: { name: 'Test', path: projectRoot, issue_prefix: 'PAN' } }];
    vi.doMock('../../../src/lib/projects.js', () => ({
      resolveProjectFromIssue: vi.fn().mockReturnValue(resolvedProject),
      resolveProjectFromIssueSync: vi.fn().mockReturnValue(resolvedProject),
      getProjectSync: vi.fn(() => null),
      hasProjects: vi.fn().mockReturnValue(true),
      hasProjectsSync: vi.fn().mockReturnValue(true),
      listProjects: vi.fn().mockReturnValue(projects),
      listProjectsSync: vi.fn().mockReturnValue(projects),
    }));
    vi.doMock('../../../src/lib/work-agent-lifecycle.js', () => ({
      assertCanStartFresh: vi.fn(),
      assertCanStartFreshSync: vi.fn(),
    }));
    vi.doMock('../../../src/lib/cloister/work-agent-prompt.js', () => ({
      buildWorkAgentPrompt: vi.fn().mockResolvedValue('prompt'),
      getTrackerContext: vi.fn().mockResolvedValue(null),
      readPlanningContext: vi.fn().mockReturnValue(null),
      readBeadsTasks: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../../../src/lib/prd-draft.js', () => ({
      hasPRDDraft: vi.fn(() => Effect.succeed(false)),
      getPRDDraftPath: vi.fn().mockReturnValue(null),
      getPRDDraftPathSync: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('../../../src/lib/config.js', () => ({
      loadConfig: vi.fn().mockReturnValue({ remote: { enabled: false } }),
      loadConfigSync: vi.fn().mockReturnValue({ remote: { enabled: false } }),
    }));
    vi.doMock('../../../src/lib/tracker-utils.js', () => ({
      isGitHubIssueSync: vi.fn().mockReturnValue(false),
      resolveGitHubIssueSync: vi.fn().mockReturnValue({ isGitHub: false }),
    }));
    vi.doMock('../../../src/lib/shadow-mode.js', () => ({
      shouldSkipTrackerUpdate: vi.fn(() => Effect.succeed(false)),
      getShadowModeStatus: vi.fn().mockReturnValue({ enabled: false }),
    }));
    vi.doMock('../../../src/lib/shadow-state.js', () => ({
      createShadowState: vi.fn(() => Effect.succeed(undefined)),
      updateShadowState: vi.fn(() => Effect.succeed(undefined)),
    }));
    vi.doMock('../../../src/lib/remote/workspace-metadata.js', () => ({
      loadWorkspaceMetadataSync: vi.fn().mockReturnValue(null),
      findRemoteWorkspaceMetadataSync: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('../../../src/lib/remote/index.js', () => ({
      isRemoteAvailable: vi.fn().mockResolvedValue(false),
      spawnRemoteAgent: vi.fn(),
      isRemoteAgentRunning: vi.fn().mockResolvedValue(false),
      createFlyProviderFromConfig: vi.fn(),
    }));

    const agents = await import('../../../src/lib/agents.js');
    const lifecycle = await import('../../../src/lib/work-agent-lifecycle.js');
    const start = await import('../../../src/cli/commands/start.js');
    return { agents, issueCommand: start.issueCommand, assertCanStartFresh: lifecycle.assertCanStartFreshSync };
  }

  it('skips paused agents even when review feedback is pending', async () => {
    const agentId = 'agent-pan-1141-paused';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      paused: true,
      pausedReason: 'manual inspection',
      pausedAt: BASE_TIME.toISOString(),
    });

    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual([]);
    expect(resumeAgentMock).not.toHaveBeenCalled();
  });

  it('logs verify-paused instead of manually-paused for merged paused agents', async () => {
    const agentId = 'agent-pan-1141-verify-paused';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    const reviewStatus = await import('../../../src/lib/review-status.js');
    const logger = await import('../../../src/lib/persistent-logger.js');
    vi.mocked(reviewStatus.getReviewStatusSync).mockReturnValue({
      issueId: 'PAN-1141',
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      readyForMerge: false,
      updatedAt: BASE_TIME.toISOString(),
    });
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      paused: true,
      pausedReason: 'awaiting close-out (verify on main)',
      pausedAt: BASE_TIME.toISOString(),
    });

    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual([]);
    expect(resumeAgentMock).not.toHaveBeenCalled();
    expect(vi.mocked(logger.logDeaconEventSync)).toHaveBeenCalledWith(expect.stringContaining('verify-paused'));
  });

  it('pan pause stops stale-running agents without live tmux sessions', async () => {
    const agentId = 'agent-pan-1141';
    const { agents } = await loadDeaconWithResumeMock();
    const pause = await import('../../../src/cli/commands/pause.js');
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: BASE_TIME.toISOString(),
    });

    await pause.pauseCommand('PAN-1141', { reason: 'manual inspection' });

    const state = agents.getAgentStateSync(agentId);
    expect(state?.status).toBe('stopped');
    expect(state?.paused).toBe(true);
    expect(state?.pausedReason).toBe('manual inspection');
    expect(state?.stoppedByPause).toBe(true);
    expect(state?.stoppedByUser).toBe(true);
  });

  it('coalesces concurrent orphan recovery scans', async () => {
    const agentId = 'agent-pan-1141-orphan';
    const { agents, recoverOrphanedAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: BASE_TIME.toISOString(),
    });

    await Promise.all([
      recoverOrphanedAgents('startup'),
      recoverOrphanedAgents('patrol'),
    ]);

    const state = agents.getAgentStateSync(agentId);
    expect(state?.status).toBe('stopped');
    expect(state?.consecutiveFailures).toBe(1);
  });

  it('retries stopped work agents whose initial kickoff was never delivered even when runtime is idle', async () => {
    const agentId = 'agent-pan-2093';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    const reviewStatus = await import('../../../src/lib/review-status.js');
    vi.mocked(reviewStatus.getReviewStatusSync).mockReturnValue({
      issueId: 'PAN-2093',
      reviewStatus: 'pending',
      testStatus: 'pending',
      verificationStatus: 'pending',
      readyForMerge: false,
      updatedAt: BASE_TIME.toISOString(),
    });
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-2093',
      workspace: workspaceFor(agentId),
      harness: 'ohmypi',
      role: 'work',
      model: 'kimi-k2.7-code',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      kickoffDelivered: false,
      consecutiveFailures: 1,
      lastFailureReason: 'orphaned: tmux session missing (reconcile)',
    });
    await agents.saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: BASE_TIME.toISOString(),
    });

    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual([agentId]);
    expect(resumeAgentMock).toHaveBeenCalledWith(agentId);
  });

  it('recovers orphaned strike agents whose registered session is missing', async () => {
    const agentId = 'strike-pan-1820';
    const { agents, recoverOrphanedAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1820',
      workspace: workspaceFor(agentId),
      harness: 'codex',
      role: 'strike',
      model: 'gpt-5',
      status: 'running',
      startedAt: BASE_TIME.toISOString(),
    });

    const actions = await recoverOrphanedAgents('patrol');

    expect(actions).toEqual([`Recovered orphaned agent ${agentId} (running→stopped)`]);
    const state = agents.getAgentStateSync(agentId);
    expect(state?.status).toBe('stopped');
    expect(state?.consecutiveFailures).toBe(1);
  });

  it('does not orphan-recover verify-paused running agents with killed tmux sessions', async () => {
    const agentId = 'agent-pan-1141-verify-orphan';
    const { agents, recoverOrphanedAgents } = await loadDeaconWithResumeMock();
    const reviewStatus = await import('../../../src/lib/review-status.js');
    const logger = await import('../../../src/lib/persistent-logger.js');
    vi.mocked(reviewStatus.getReviewStatusSync).mockReturnValue({
      issueId: 'PAN-1141',
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'merged',
      readyForMerge: false,
      updatedAt: BASE_TIME.toISOString(),
    });
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: BASE_TIME.toISOString(),
      paused: true,
      pausedReason: 'awaiting close-out (verify on main)',
      pausedAt: BASE_TIME.toISOString(),
    });

    const actions = await recoverOrphanedAgents('patrol');

    const state = agents.getAgentStateSync(agentId);
    expect(actions).toEqual([]);
    expect(state?.status).toBe('running');
    expect(state?.consecutiveFailures).toBeUndefined();
    expect(vi.mocked(logger.logDeaconEventSync)).toHaveBeenCalledWith(expect.stringContaining('verify-paused'));
  });

  it('counts rapid post-resume orphan deaths toward the troubled gate', async () => {
    const agentId = 'agent-pan-1141-rapid-death';
    const { agents, recoverOrphanedAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'pi',
      role: 'work',
      model: 'kimi-k2.6',
      status: 'running',
      startedAt: BASE_TIME.toISOString(),
      lastResumeAt: new Date(BASE_TIME.getTime() - 30_000).toISOString(),
      consecutiveFailures: 2,
      firstFailureInRunAt: new Date(BASE_TIME.getTime() - 4 * 60_000).toISOString(),
      lastFailureAt: new Date(BASE_TIME.getTime() - 2 * 60_000).toISOString(),
      lastFailureReason: 'rapid post-resume death: tmux session missing within 120s (patrol)',
      lastFailureNextRetryAt: new Date(BASE_TIME.getTime() - 90_000).toISOString(),
    });

    const actions = await recoverOrphanedAgents('patrol');

    expect(actions).toEqual([`Recovered orphaned agent ${agentId} (running→stopped)`]);
    const state = agents.getAgentStateSync(agentId);
    expect(state?.status).toBe('stopped');
    expect(state?.consecutiveFailures).toBe(3);
    expect(state?.troubled).toBe(true);
    expect(state?.lastFailureReason).toContain('rapid post-resume death');
  });

  it('starts a fresh failure run when an orphan death is not rapid after resume', async () => {
    const agentId = 'agent-pan-1141-late-death';
    const { agents, recoverOrphanedAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'pi',
      role: 'work',
      model: 'kimi-k2.6',
      status: 'running',
      startedAt: BASE_TIME.toISOString(),
      lastResumeAt: new Date(BASE_TIME.getTime() - 5 * 60_000).toISOString(),
      consecutiveFailures: 2,
      firstFailureInRunAt: new Date(BASE_TIME.getTime() - 6 * 60_000).toISOString(),
      lastFailureAt: new Date(BASE_TIME.getTime() - 5 * 60_000).toISOString(),
      lastFailureReason: 'rapid post-resume death: tmux session missing within 120s (patrol)',
      lastFailureNextRetryAt: new Date(BASE_TIME.getTime() - 4 * 60_000).toISOString(),
    });

    await recoverOrphanedAgents('patrol');

    const state = agents.getAgentStateSync(agentId);
    expect(state?.status).toBe('stopped');
    expect(state?.consecutiveFailures).toBe(1);
    expect(state?.troubled).toBeUndefined();
    expect(state?.lastFailureReason).toBe('orphaned: tmux session missing (patrol)');
  });

  it('queues feedback without resuming paused agents', async () => {
    const agentId = 'agent-pan-1141-feedback-paused';
    const { agents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      paused: true,
      pausedReason: 'manual inspection',
      pausedAt: BASE_TIME.toISOString(),
    });

    await agents.messageAgent(agentId, 'review feedback');

    const state = agents.getAgentStateSync(agentId);
    expect(state?.status).toBe('stopped');
    expect(state?.paused).toBe(true);
    const mailDir = join(agents.getAgentDir(agentId), 'mail');
    const mailFiles = readdirSync(mailDir);
    expect(mailFiles).toHaveLength(1);
    expect(readFileSync(join(mailDir, mailFiles[0]), 'utf-8')).toContain('review feedback');
  });

  it('auto-resumes unpaused agents stopped by pause', async () => {
    const agentId = 'agent-pan-1141-paused-stop';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      stoppedByUser: true,
      stoppedByPause: true,
      paused: true,
      pausedReason: 'manual inspection',
      pausedAt: BASE_TIME.toISOString(),
    });

    agents.clearAgentPausedSync(agentId);
    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual([agentId]);
    expect(resumeAgentMock).toHaveBeenCalledWith(agentId);
    const state = agents.getAgentStateSync(agentId);
    expect(state?.paused).toBeUndefined();
    expect(state?.stoppedByPause).toBeUndefined();
    expect(state?.stoppedByUser).toBeUndefined();
  });

  it('keeps manual-stop intent when unpausing an agent not stopped by pause', async () => {
    const agentId = 'agent-pan-1141-paused-killed';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      stoppedByUser: true,
      paused: true,
      pausedReason: 'manual inspection',
      pausedAt: BASE_TIME.toISOString(),
    });

    agents.clearAgentPausedSync(agentId);
    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual([]);
    expect(resumeAgentMock).not.toHaveBeenCalled();
    expect(agents.getAgentStateSync(agentId)?.stoppedByUser).toBe(true);
  });

  it('skips troubled agents', async () => {
    const agentId = 'agent-pan-1141-troubled';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      troubled: true,
      troubledAt: BASE_TIME.toISOString(),
      consecutiveFailures: 3,
      firstFailureInRunAt: BASE_TIME.toISOString(),
    });

    const resumed = await autoResumeStoppedWorkAgents();

    expect(resumed).toEqual([]);
    expect(resumeAgentMock).not.toHaveBeenCalled();
  });

  it('makes pending boot reconciliation hold auto-resume but not orphan recovery', async () => {
    bootReconciliationState = {
      decision: 'pending',
      perAgent: {},
      decidedAt: BASE_TIME.toISOString(),
      bootId: 'boot-test',
      graceDeadline: new Date(BASE_TIME.getTime() + 30_000).toISOString(),
    };
    const stoppedAgentId = 'agent-pan-1141-boot-held-stopped';
    const runningAgentId = 'agent-pan-1141-boot-held-running';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents, recoverOrphanedAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentStateSync({
      id: stoppedAgentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(stoppedAgentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
    });
    agents.saveAgentStateSync({
      id: runningAgentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(runningAgentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: BASE_TIME.toISOString(),
    });

    const resumed = await autoResumeStoppedWorkAgents();
    const recovered = await recoverOrphanedAgents('test');

    expect(resumed).toEqual([]);
    expect(recovered).toEqual([
      `Recovered orphaned agent ${runningAgentId} (running→stopped)`,
    ]);
    expect(resumeAgentMock).not.toHaveBeenCalled();
    expect(agents.getAgentStateSync(runningAgentId)?.status).toBe('stopped');
  });

  // PAN-1665: throttle so unfreezing the deacon doesn't thundering-herd the box.
  // The resume loop schedules a 150ms stagger setTimeout *between* awaits, so a
  // single runAllTimersAsync() can race ahead of the first scheduled timer. Advance
  // in a loop until the promise settles to fire each stagger as it's scheduled.
  async function settleWithStagger<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    const wrapped = promise.finally(() => { done = true; });
    while (!done) {
      await vi.advanceTimersByTimeAsync(150);
    }
    return wrapped;
  }

  function saveCandidate(agents: typeof import('../../../src/lib/agents.js'), agentId: string) {
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(agentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
    });
  }

  it('resumes only up to the free work slots and defers the rest (concurrency cap)', async () => {
    resumeAgentMock.mockResolvedValue({ success: true });
    resumeSlotsMock = 3; // only 3 free work slots this patrol
    // Low load, plenty of cores → load gate stays open; only the concurrency cap bites.
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock({
      loadavg: [1, 1, 1],
      cpusCount: 24,
    });
    const logger = await import('../../../src/lib/persistent-logger.js');
    for (let i = 0; i < 5; i++) saveCandidate(agents, `agent-pan-1141-herd-${i}`);

    const resumed = await settleWithStagger(autoResumeStoppedWorkAgents());

    // 3 slots → resume 3; the other two wait for a future cycle.
    expect(resumed).toHaveLength(3);
    expect(resumeAgentMock).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logger.logDeaconEventSync)).toHaveBeenCalledWith(
      expect.stringContaining('work concurrency cap reached'),
    );
  });

  it('resumes nothing when already at the work-agent cap (never kills, lets attrition drain)', async () => {
    resumeAgentMock.mockResolvedValue({ success: true });
    resumeSlotsMock = 0; // already at/over the cap
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock({
      loadavg: [1, 1, 1],
      cpusCount: 24,
    });
    for (let i = 0; i < 4; i++) saveCandidate(agents, `agent-pan-1141-overcap-${i}`);

    const resumed = await settleWithStagger(autoResumeStoppedWorkAgents());

    expect(resumed).toEqual([]);
    expect(resumeAgentMock).not.toHaveBeenCalled();
  });

  it('skips all resumes when system load already exceeds the ceiling', async () => {
    resumeAgentMock.mockResolvedValue({ success: true });
    // load 100 on 8 cores → ceiling 12 (8 * 1.5), gate trips before any resume.
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock({
      loadavg: [100, 100, 100],
      cpusCount: 8,
    });
    const logger = await import('../../../src/lib/persistent-logger.js');
    saveCandidate(agents, 'agent-pan-1141-loaded-0');
    saveCandidate(agents, 'agent-pan-1141-loaded-1');

    const resumed = await settleWithStagger(autoResumeStoppedWorkAgents());

    expect(resumed).toEqual([]);
    expect(resumeAgentMock).not.toHaveBeenCalled();
    expect(vi.mocked(logger.logDeaconEventSync)).toHaveBeenCalledWith(
      expect.stringContaining('load gate tripped'),
    );
  });

  it('clears paused state and spawns when pan start --force is not a dry run', async () => {
    const { agents, issueCommand, assertCanStartFresh } = await loadStartCommand();
    const agentId = 'agent-pan-1141';
    vi.mocked(assertCanStartFresh).mockImplementation((_id, options?: { allowPausedForce?: boolean }) => {
      if (options?.allowPausedForce !== true) {
        throw new Error('lifecycle guard blocked');
      }
      return {} as ReturnType<typeof assertCanStartFresh>;
    });
    mkdirSync(join(projectRoot, 'workspaces', 'feature-pan-1141', '.beads'), { recursive: true });
    writeFileSync(join(projectRoot, 'workspaces', 'feature-pan-1141', '.beads', 'issues.jsonl'), '{"id":"PAN-1141","labels":["pan-1141"]}\n');
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: join(projectRoot, 'workspaces', 'feature-pan-1141'),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      stoppedByUser: true,
      stoppedByPause: true,
      paused: true,
      pausedReason: 'manual inspection',
      pausedAt: BASE_TIME.toISOString(),
    });

    await issueCommand('PAN-1141', { model: '', force: true } as any);

    expect(assertCanStartFresh).toHaveBeenCalledWith('PAN-1141', { allowPausedForce: true });
    expect(agents.spawnAgent).toHaveBeenCalled();
    const state = agents.getAgentStateSync(agentId);
    expect(state?.paused).toBeUndefined();
    expect(state?.pausedReason).toBeUndefined();
    expect(state?.pausedAt).toBeUndefined();
    expect(state?.stoppedByPause).toBeUndefined();
    expect(state?.stoppedByUser).toBeUndefined();
  });

  it('lets parallel pan start --host --yes flows return after spawning every work agent', async () => {
    vi.useRealTimers();
    const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const { agents, issueCommand } = await loadStartCommand();
      const workspace = join(projectRoot, 'workspaces', 'feature-pan-1141');
      mkdirSync(join(workspace, '.beads'), { recursive: true });
      writeFileSync(join(workspace, '.beads', 'issues.jsonl'), '{"id":"PAN-1141","labels":["pan-1141"]}\n');

      const startedAt = Date.now();
      await Promise.all(Array.from({ length: 5 }, () => issueCommand('PAN-1141', {
        model: '',
        host: true,
        yes: true,
      } as any)));

      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(agents.spawnAgent).toHaveBeenCalledTimes(5);
      for (const call of vi.mocked(agents.spawnAgent).mock.calls) {
        expect(call[0]).toEqual(expect.objectContaining({
          issueId: 'PAN-1141',
          workspace,
          role: 'work',
          allowHost: true,
        }));
      }
    } finally {
      if (stdinIsTTYDescriptor) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTTYDescriptor);
      } else {
        delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
      }
    }
  });

  it('keeps paused state when pan start --force is only a dry run', async () => {
    const { agents, issueCommand } = await loadStartCommand();
    const agentId = 'agent-pan-1141';
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: join(projectRoot, 'workspaces', 'feature-pan-1141'),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      paused: true,
      pausedReason: 'manual inspection',
      pausedAt: BASE_TIME.toISOString(),
    });

    await issueCommand('PAN-1141', { model: '', force: true, dryRun: true } as any);

    const state = agents.getAgentStateSync(agentId);
    expect(state?.paused).toBe(true);
    expect(state?.pausedReason).toBe('manual inspection');
    expect(state?.pausedAt).toBe(BASE_TIME.toISOString());
  });

  it('refuses pan start without --force when paused', async () => {
    const { agents, issueCommand } = await loadStartCommand();
    const agentId = 'agent-pan-1141';
    agents.saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1141',
      workspace: join(projectRoot, 'workspaces', 'feature-pan-1141'),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
      paused: true,
      pausedReason: 'manual inspection',
      pausedAt: BASE_TIME.toISOString(),
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);

    await expect(issueCommand('PAN-1141', { model: '' } as any)).rejects.toThrow(/__exit__:1/);

    const written = stderrSpy.mock.calls.map(call => String(call[0])).join('');
    expect(written).toContain('agent-pan-1141');
    expect(written).toContain('manual inspection');
    expect(written).toContain('pan unpause PAN-1141');
    expect(agents.getAgentStateSync(agentId)?.paused).toBe(true);
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
