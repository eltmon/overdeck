import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_TIME = new Date('2026-05-17T12:00:00.000Z');

describe('auto-resume gates', () => {
  let tempHome: string;
  let projectRoot: string;
  let originalHome: string | undefined;
  let originalNoResume: string | undefined;
  let originalCwd: string;
  let resumeAgentMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    vi.resetModules();
    vi.clearAllMocks();

    tempHome = mkdtempSync(join(tmpdir(), 'pan-auto-resume-gating-'));
    projectRoot = join(tempHome, 'project');
    mkdirSync(join(projectRoot, 'workspaces', 'feature-pan-1141'), { recursive: true });
    originalHome = process.env.PANOPTICON_HOME;
    originalNoResume = process.env.PANOPTICON_NO_RESUME;
    originalCwd = process.cwd();
    process.env.PANOPTICON_HOME = tempHome;
    delete process.env.PANOPTICON_NO_RESUME;
    resumeAgentMock = vi.fn();
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
    vi.doUnmock('../../../src/lib/database/review-status-db.js');
    vi.doUnmock('../../../src/lib/cloister/specialists.js');
    vi.doUnmock('../../../src/lib/cloister/merge-agent.js');
    vi.doUnmock('../../../src/lib/projects.js');
    vi.doUnmock('../../../src/lib/work-agent-lifecycle.js');
    vi.doUnmock('../../../src/lib/cloister/work-agent-prompt.js');
    vi.doUnmock('../../../src/lib/prd-draft.js');
    vi.doUnmock('../../../src/lib/config.js');
    vi.doUnmock('../../../src/lib/remote/index.js');
    vi.doUnmock('../../../src/lib/tmux.js');
    vi.doUnmock('child_process');
    vi.doUnmock('ora');
    vi.resetModules();

    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = originalHome;
    if (originalNoResume === undefined) delete process.env.PANOPTICON_NO_RESUME;
    else process.env.PANOPTICON_NO_RESUME = originalNoResume;
    rmSync(tempHome, { recursive: true, force: true });
  });

  function workspaceFor(agentId: string): string {
    const workspace = join(tempHome, 'workspaces', agentId);
    mkdirSync(workspace, { recursive: true });
    return workspace;
  }

  async function loadDeaconWithResumeMock() {
    vi.doMock('../../../src/lib/agents.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../src/lib/agents.js')>();
      return {
        ...actual,
        resumeAgent: (...args: unknown[]) => resumeAgentMock(...args),
        listRunningAgents: vi.fn().mockResolvedValue([]),
      };
    });
    vi.doMock('../../../src/lib/review-status.js', () => ({
      getReviewStatus: vi.fn().mockReturnValue({
        reviewStatus: 'blocked',
        testStatus: 'pending',
        verificationStatus: 'passed',
        readyForMerge: false,
      }),
      loadReviewStatuses: vi.fn().mockReturnValue({}),
      setReviewStatus: vi.fn(),
    }));
    vi.doMock('../../../src/lib/shadow-state.js', () => ({
      getShadowState: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock('../../../src/lib/activity-logger.js', () => ({
      emitActivityEntry: vi.fn(),
      emitActivityTts: vi.fn(),
    }));
    vi.doMock('../../../src/lib/persistent-logger.js', () => ({
      logDeaconEvent: vi.fn(),
      logAgentLifecycle: vi.fn(),
    }));
    vi.doMock('../../../src/lib/database/app-settings.js', () => ({
      isDeaconGloballyPaused: vi.fn().mockReturnValue(false),
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
      killSessionAsync: vi.fn().mockResolvedValue(undefined),
      listPaneValues: vi.fn().mockReturnValue([]),
      listPaneValuesAsync: vi.fn().mockResolvedValue([]),
      listSessionNamesAsync: vi.fn().mockResolvedValue([]),
      sessionExists: vi.fn().mockReturnValue(false),
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
        execFile: vi.fn(),
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
    vi.doMock('../../../src/lib/projects.js', () => ({
      resolveProjectFromIssue: vi.fn().mockReturnValue({
        projectKey: 'test',
        projectName: 'Test',
        projectPath: projectRoot,
      }),
      hasProjects: vi.fn().mockReturnValue(true),
      listProjects: vi.fn().mockReturnValue([{ key: 'test', config: { name: 'Test', path: projectRoot, issue_prefix: 'PAN' } }]),
    }));
    vi.doMock('../../../src/lib/work-agent-lifecycle.js', () => ({
      assertCanStartFresh: vi.fn(),
    }));
    vi.doMock('../../../src/lib/cloister/work-agent-prompt.js', () => ({
      buildWorkAgentPrompt: vi.fn().mockResolvedValue('prompt'),
      getTrackerContext: vi.fn().mockResolvedValue(null),
      readPlanningContext: vi.fn().mockReturnValue(null),
      readBeadsTasks: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../../../src/lib/prd-draft.js', () => ({
      hasPRDDraft: vi.fn().mockReturnValue(false),
      getPRDDraftPath: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('../../../src/lib/config.js', () => ({
      loadConfig: vi.fn().mockReturnValue({ remote: { enabled: false } }),
    }));
    vi.doMock('../../../src/lib/remote/index.js', () => ({
      isRemoteAvailable: vi.fn().mockResolvedValue(false),
      spawnRemoteAgent: vi.fn(),
      isRemoteAgentRunning: vi.fn().mockResolvedValue(false),
      createFlyProviderFromConfig: vi.fn(),
    }));

    const agents = await import('../../../src/lib/agents.js');
    const start = await import('../../../src/cli/commands/start.js');
    return { agents, issueCommand: start.issueCommand };
  }

  it('skips paused agents even when review feedback is pending', async () => {
    const agentId = 'agent-pan-1141-paused';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentState({
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

  it('skips troubled agents', async () => {
    const agentId = 'agent-pan-1141-troubled';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentState({
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

  it('makes no-resume mode skip auto-resume and orphan recovery', async () => {
    process.env.PANOPTICON_NO_RESUME = '1';
    const stoppedAgentId = 'agent-pan-1141-no-resume-stopped';
    const runningAgentId = 'agent-pan-1141-no-resume-running';
    resumeAgentMock.mockResolvedValue({ success: true });
    const { agents, autoResumeStoppedWorkAgents, recoverOrphanedAgents } = await loadDeaconWithResumeMock();
    agents.saveAgentState({
      id: stoppedAgentId,
      issueId: 'PAN-1141',
      workspace: workspaceFor(stoppedAgentId),
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: BASE_TIME.toISOString(),
    });
    agents.saveAgentState({
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
    expect(recovered).toEqual([]);
    expect(resumeAgentMock).not.toHaveBeenCalled();
    expect(agents.getAgentState(runningAgentId)?.status).toBe('running');
  });

  it('keeps paused state when pan start --force is only a dry run', async () => {
    const { agents, issueCommand } = await loadStartCommand();
    const agentId = 'agent-pan-1141';
    agents.saveAgentState({
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

    const state = agents.getAgentState(agentId);
    expect(state?.paused).toBe(true);
    expect(state?.pausedReason).toBe('manual inspection');
    expect(state?.pausedAt).toBe(BASE_TIME.toISOString());
  });

  it('refuses pan start without --force when paused', async () => {
    const { agents, issueCommand } = await loadStartCommand();
    const agentId = 'agent-pan-1141';
    agents.saveAgentState({
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
    expect(agents.getAgentState(agentId)?.paused).toBe(true);
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
