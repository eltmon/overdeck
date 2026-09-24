import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const issueIdMocks = vi.hoisted(() => ({
  resolveBareNumericId: vi.fn(),
}));

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  setAgentPaused: vi.fn(),
  clearAgentPaused: vi.fn(),
  clearAgentTroubled: vi.fn(),
  stopAgent: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  extractTeamPrefix: vi.fn(),
  findProjectByTeam: vi.fn(),
}));

const workspaceMocks = vi.hoisted(() => ({
  stopWorkspaceDocker: vi.fn(),
  findWorkspacePath: vi.fn(),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(),
}));

const unpauseMocks = vi.hoisted(() => ({
  getWorkAgentLifecycleState: vi.fn(),
  resumeAgent: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
  closeOut: vi.fn(),
}));

const trackerMocks = vi.hoisted(() => ({
  resolveTrackerType: vi.fn(),
  isGitHubIssue: vi.fn(),
  resolveGitHubIssue: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
  execFile: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('../../../lib/issue-id.js', () => ({
  resolveBareNumericId: issueIdMocks.resolveBareNumericId,
}));

vi.mock('../../../lib/agents.js', () => {
  // Mirror the real prefix/singleton routing (PAN-1760) so command targeting
  // stays under test while the heavy agents module remains mocked.
  const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-', 'strike-', 'inspect-'];
  const isQualifiedAgentId = (input: string) => {
    const lower = input.toLowerCase();
    return lower === 'flywheel-orchestrator' || AGENT_PREFIXES.some(p => lower.startsWith(p));
  };
  return {
    getAgentState: agentMocks.getAgentState,
    setAgentPaused: agentMocks.setAgentPaused,
    clearAgentPaused: agentMocks.clearAgentPaused,
    clearAgentTroubled: agentMocks.clearAgentTroubled,
    stopAgent: agentMocks.stopAgent,
    isQualifiedAgentId,
    normalizeAgentId: (id: string) => (isQualifiedAgentId(id) ? id : `agent-${id.toLowerCase()}`),
    resolveAgentTarget: (input: string) => {
      if (isQualifiedAgentId(input)) return input.toLowerCase();
      const issueId = issueIdMocks.resolveBareNumericId(input);
      return issueId ? `agent-${String(issueId).toLowerCase()}` : null;
    },
  };
});

// PAN-3947: pan kill/pause probe liveness through the terminal backend;
// the fake mirrors the tmux session mock so each case sets liveness once.
vi.mock('../../../lib/terminal-backends/launch.js', () => ({
  agentPaneExists: vi.fn(async (id: string) => (tmuxMocks.sessionExistsSync as (name: string) => boolean)(id)),
}));

vi.mock('../../../lib/tmux.js', () => ({
  sessionExistsSync: tmuxMocks.sessionExistsSync,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: projectMocks.resolveProjectFromIssueSync,
  extractTeamPrefix: projectMocks.extractTeamPrefix,
  findProjectByTeam: projectMocks.findProjectByTeam,
}));

vi.mock('../../../lib/workspace-manager.js', () => ({
  stopWorkspaceDocker: workspaceMocks.stopWorkspaceDocker,
}));

vi.mock('../../../lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: workspaceMocks.findWorkspacePath,
}));

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

vi.mock('../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleState: unpauseMocks.getWorkAgentLifecycleState,
}));

vi.mock('../../../lib/agents/resume.js', () => ({
  resumeAgent: unpauseMocks.resumeAgent,
}));

vi.mock('../../../lib/lifecycle/index.js', () => ({
  closeOut: lifecycleMocks.closeOut,
}));

vi.mock('../../../lib/xbrief/io.js', () => ({
  readWorkspacePlanSync: vi.fn(() => ({
    plan: {
      id: 'PAN-9999',
      items: [{ id: 'workspace-abc' }],
    },
  })),
}));

vi.mock('../../../lib/tracker-utils.js', () => ({
  resolveTrackerType: trackerMocks.resolveTrackerType,
  isGitHubIssue: trackerMocks.isGitHubIssue,
  resolveGitHubIssue: trackerMocks.resolveGitHubIssue,
}));

vi.mock('../../../lib/shadow-utils.js', () => ({
  getLinearApiKey: vi.fn(() => 'linear-key'),
}));

vi.mock('../../../lib/cloister/work-agent-prompt.js', () => ({
  getTrackerContext: vi.fn(() => ({ apiKey: 'linear-key' })),
}));

vi.mock('../../../lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/config.js')>()),
  getDashboardApiUrl: vi.fn(() => 'http://dashboard.test'),
}));

vi.mock('@overdeck/contracts', () => ({
  EDITORS: [{ id: 'code', label: 'VS Code', command: 'code' }],
}));

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: fsMocks.existsSync,
  readFileSync: fsMocks.readFileSync,
}));

vi.mock('node:fs', () => ({
  existsSync: fsMocks.existsSync,
}));

vi.mock('node:child_process', () => ({
  spawn: childProcessMocks.spawn,
  execSync: childProcessMocks.execSync,
  execFile: childProcessMocks.execFile,
  exec: childProcessMocks.exec,
}));

vi.mock('child_process', () => ({
  spawn: childProcessMocks.spawn,
  execSync: childProcessMocks.execSync,
  execFile: childProcessMocks.execFile,
  exec: childProcessMocks.exec,
}));

describe('resolveBareNumericId rollout (PAN-1173)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    issueIdMocks.resolveBareNumericId.mockReset();
    issueIdMocks.resolveBareNumericId.mockReturnValue('PAN-9999');
    agentMocks.getAgentState.mockReset();
    agentMocks.getAgentState.mockReturnValue({
      issueId: 'PAN-9999',
      status: 'stopped',
      paused: true,
      troubled: true,
      consecutiveFailures: 1,
    });
    agentMocks.setAgentPaused.mockReset();
    agentMocks.clearAgentPaused.mockReset();
    agentMocks.clearAgentTroubled.mockReset();
    agentMocks.setAgentPaused.mockReturnValue(Effect.succeed(null));
    agentMocks.clearAgentPaused.mockReturnValue(Effect.succeed(null));
    agentMocks.clearAgentTroubled.mockReturnValue(Effect.succeed(null));
    agentMocks.stopAgent.mockReset();
    agentMocks.stopAgent.mockReturnValue(Effect.void);
    tmuxMocks.sessionExistsSync.mockReset();
    tmuxMocks.sessionExistsSync.mockReturnValue(false);
    projectMocks.resolveProjectFromIssueSync.mockReset();
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project', projectKey: 'overdeck' });
    projectMocks.extractTeamPrefix.mockReset();
    projectMocks.extractTeamPrefix.mockReturnValue(null);
    projectMocks.findProjectByTeam.mockReset();
    projectMocks.findProjectByTeam.mockReturnValue(null);
    workspaceMocks.stopWorkspaceDocker.mockReset();
    workspaceMocks.stopWorkspaceDocker.mockResolvedValue({ containersFound: false, steps: [] });
    workspaceMocks.findWorkspacePath.mockReset();
    workspaceMocks.findWorkspacePath.mockReturnValue(null);
    interventionMocks.appendOperatorInterventionEvent.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);
    unpauseMocks.getWorkAgentLifecycleState.mockReset();
    unpauseMocks.getWorkAgentLifecycleState.mockReturnValue({ canResumeSession: false });
    unpauseMocks.resumeAgent.mockReset();
    unpauseMocks.resumeAgent.mockResolvedValue({ success: true });
    lifecycleMocks.closeOut.mockReset();
    lifecycleMocks.closeOut.mockReturnValue(Effect.succeed({ success: true, steps: [] }));
    trackerMocks.resolveTrackerType.mockReset();
    trackerMocks.resolveTrackerType.mockReturnValue('rally');
    trackerMocks.isGitHubIssue.mockReset();
    trackerMocks.isGitHubIssue.mockReturnValue(true);
    trackerMocks.resolveGitHubIssue.mockReset();
    trackerMocks.resolveGitHubIssue.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'overdeck', number: 9999 });
    fsMocks.existsSync.mockReset();
    fsMocks.existsSync.mockImplementation((path: string) => !path.endsWith('.overdeck.env'));
    fsMocks.readFileSync.mockReset();
    fsMocks.readFileSync.mockReturnValue('');
    childProcessMocks.spawn.mockReset();
    childProcessMocks.spawn.mockReturnValue({ unref: vi.fn() });
    childProcessMocks.execSync.mockReset();
    childProcessMocks.execFile.mockReset();
    childProcessMocks.exec.mockReset();
    childProcessMocks.exec.mockImplementation((_cmd, callback) => {
      callback(null, { stdout: '', stderr: '' });
    });
    childProcessMocks.execFile.mockImplementation((_cmd, _args, _options, callback) => {
      callback(null, JSON.stringify({ state: 'OPEN', labels: [{ name: 'verifying-on-main' }] }), '');
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ success: true, message: 'ok' }),
    })));
    delete process.env.OVERDECK_AGENT_ID;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('resolves bare numeric input before pan kill stops the agent', async () => {
    // PAN-1526: kill discovers agents by scanning AGENTS_DIR, then falls back to
    // the canonical work-agent session. There's no agent dir on disk here, so
    // make the canonical session live for the fallback to pick it up.
    tmuxMocks.sessionExistsSync.mockReturnValue(true);
    const { killCommand } = await import('../kill.js');

    await killCommand('9999', {});

    expect(issueIdMocks.resolveBareNumericId).toHaveBeenCalledWith('9999');
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('agent-pan-9999', 'operator');
  });

  it('resolves bare numeric input before pan pause pauses the agent', async () => {
    const { pauseCommand } = await import('../pause.js');

    await pauseCommand('9999', { reason: 'operator' });

    expect(issueIdMocks.resolveBareNumericId).toHaveBeenCalledWith('9999');
    expect(agentMocks.setAgentPaused).toHaveBeenCalledWith('agent-pan-9999', 'operator', false);
  });

  it('resolves bare numeric input before pan unpause clears the pause gate', async () => {
    const { unpauseCommand } = await import('../unpause.js');

    await unpauseCommand('9999');

    expect(issueIdMocks.resolveBareNumericId).toHaveBeenCalledWith('9999');
    expect(agentMocks.clearAgentPaused).toHaveBeenCalledWith('agent-pan-9999');
  });

  it('resolves bare numeric input before pan reopen resolves the tracker', async () => {
    const { reopenCommand } = await import('../reopen.js');

    await expect(reopenCommand('9999', { force: true })).rejects.toThrow('process.exit:1');

    expect(issueIdMocks.resolveBareNumericId).toHaveBeenCalledWith('9999');
    expect(trackerMocks.resolveTrackerType).toHaveBeenCalledWith('PAN-9999');
  });

  it('resolves bare numeric input before pan close resolves the project', async () => {
    const { closeOutCommand } = await import('../close.js');

    await closeOutCommand('9999', { force: true, json: true });

    expect(issueIdMocks.resolveBareNumericId).toHaveBeenCalledWith('9999');
    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-9999');
    expect(lifecycleMocks.closeOut).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: 'PAN-9999' }),
      expect.objectContaining({ dodAcceptedRows: [] }),
    );
  });

  it('resolves bare numeric input before pan open resolves the project', async () => {
    const { openCommand } = await import('../open.js');

    await openCommand('9999', { editor: 'code' });

    expect(issueIdMocks.resolveBareNumericId).toHaveBeenCalledWith('9999');
    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-9999');
    expect(childProcessMocks.spawn).toHaveBeenCalledWith('code', ['/tmp/project/workspaces/feature-pan-9999'], expect.any(Object));
  });

  it('resolves bare numeric input before pan review restart resolves the project', async () => {
    const { reviewRestartCommand } = await import('../review-restart.js');

    await reviewRestartCommand('9999');

    expect(issueIdMocks.resolveBareNumericId).toHaveBeenCalledWith('9999');
    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-9999');
    expect(fetch).toHaveBeenCalledWith('http://dashboard.test/api/specialists/overdeck/PAN-9999/review/restart', expect.any(Object));
  });

  it('routes pan review restart --role to the per-reviewer recovery endpoint', async () => {
    const { reviewRestartCommand } = await import('../review-restart.js');

    await reviewRestartCommand('9999', { role: 'correctness' });

    expect(fetch).toHaveBeenCalledWith(
      'http://dashboard.test/api/specialists/overdeck/PAN-9999/reviewer/correctness/restart',
      expect.any(Object),
    );
  });

  // #3853: the route grants operator standing unless the caller is an agent.
  it('tells the restart route whether an agent or the operator is calling', async () => {
    const { reviewRestartCommand } = await import('../review-restart.js');
    const postedBody = (call: number) =>
      JSON.parse((vi.mocked(fetch).mock.calls[call][1] as RequestInit).body as string) as { callerKind?: string };

    process.env.OVERDECK_AGENT_ID = 'flywheel-overdeck';
    try {
      await reviewRestartCommand('9999');
    } finally {
      delete process.env.OVERDECK_AGENT_ID;
    }
    await reviewRestartCommand('9999');

    expect(postedBody(0).callerKind).toBe('agent');
    expect(postedBody(1).callerKind).toBe('operator');
  });

  it('does not fail pan review restart when an accepted response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => 'true unexpected trailer',
    })));
    const { reviewRestartCommand } = await import('../review-restart.js');

    await reviewRestartCommand('9999');

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Review restarted for PAN-9999'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('non-JSON response'));
  });

  it('prints non-JSON pan review restart failures without a JSON parse error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      text: async () => 'true unexpected trailer',
    })));
    const { reviewRestartCommand } = await import('../review-restart.js');

    await expect(reviewRestartCommand('9999')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('true unexpected trailer'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Unexpected non-whitespace character'));
  });

  it('prints the shared unresolved-ID error path for pan kill', async () => {
    issueIdMocks.resolveBareNumericId.mockReturnValue(null);
    const { killCommand } = await import('../kill.js');

    await expect(killCommand('9999', {})).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not resolve issue ID "9999"'));
    expect(agentMocks.stopAgent).not.toHaveBeenCalled();
  });

  it('prints the shared unresolved-ID error path for pan pause', async () => {
    issueIdMocks.resolveBareNumericId.mockReturnValue(null);
    const { pauseCommand } = await import('../pause.js');

    await expect(pauseCommand('9999', {})).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not resolve agent target "9999"'));
    expect(agentMocks.setAgentPaused).not.toHaveBeenCalled();
  });

  it('prints the shared unresolved-ID error path for pan review restart', async () => {
    issueIdMocks.resolveBareNumericId.mockReturnValue(null);
    const { reviewRestartCommand } = await import('../review-restart.js');

    await expect(reviewRestartCommand('9999')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not resolve issue ID "9999"'));
    expect(projectMocks.resolveProjectFromIssueSync).not.toHaveBeenCalled();
  });
});
