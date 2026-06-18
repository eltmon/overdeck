import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const issueIdMocks = vi.hoisted(() => ({
  resolveBareNumericIdSync: vi.fn(),
}));

const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  setAgentPausedSync: vi.fn(),
  clearAgentPausedSync: vi.fn(),
  clearAgentTroubledSync: vi.fn(),
  stopAgentSync: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  extractTeamPrefix: vi.fn(),
  findProjectByTeamSync: vi.fn(),
}));

const workspaceMocks = vi.hoisted(() => ({
  stopWorkspaceDocker: vi.fn(),
  findWorkspacePath: vi.fn(),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
  closeOut: vi.fn(),
}));

const inspectMocks = vi.hoisted(() => ({
  spawnInspectAgent: vi.fn(),
  getDiffBase: vi.fn(),
  getDiffStats: vi.fn(),
}));

const trackerMocks = vi.hoisted(() => ({
  resolveTrackerTypeSync: vi.fn(),
  isGitHubIssueSync: vi.fn(),
  resolveGitHubIssueSync: vi.fn(),
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
  resolveBareNumericIdSync: issueIdMocks.resolveBareNumericIdSync,
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
    getAgentStateSync: agentMocks.getAgentStateSync,
    setAgentPausedSync: agentMocks.setAgentPausedSync,
    clearAgentPausedSync: agentMocks.clearAgentPausedSync,
    clearAgentTroubledSync: agentMocks.clearAgentTroubledSync,
    stopAgentSync: agentMocks.stopAgentSync,
    isQualifiedAgentId,
    normalizeAgentId: (id: string) => (isQualifiedAgentId(id) ? id : `agent-${id.toLowerCase()}`),
    resolveAgentTargetSync: (input: string) => {
      if (isQualifiedAgentId(input)) return input.toLowerCase();
      const issueId = issueIdMocks.resolveBareNumericIdSync(input);
      return issueId ? `agent-${String(issueId).toLowerCase()}` : null;
    },
  };
});

vi.mock('../../../lib/tmux.js', () => ({
  sessionExistsSync: tmuxMocks.sessionExistsSync,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: projectMocks.resolveProjectFromIssueSync,
  extractTeamPrefix: projectMocks.extractTeamPrefix,
  findProjectByTeamSync: projectMocks.findProjectByTeamSync,
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

vi.mock('../../../lib/lifecycle/index.js', () => ({
  closeOut: lifecycleMocks.closeOut,
}));

vi.mock('../../../lib/cloister/inspect-agent.js', () => ({
  spawnInspectAgent: inspectMocks.spawnInspectAgent,
}));

vi.mock('../../../lib/cloister/inspect-checkpoints.js', () => ({
  getDiffBase: inspectMocks.getDiffBase,
  getDiffStats: inspectMocks.getDiffStats,
}));

vi.mock('../../../lib/tracker-utils.js', () => ({
  resolveTrackerTypeSync: trackerMocks.resolveTrackerTypeSync,
  isGitHubIssueSync: trackerMocks.isGitHubIssueSync,
  resolveGitHubIssueSync: trackerMocks.resolveGitHubIssueSync,
}));

vi.mock('../../../lib/shadow-utils.js', () => ({
  getLinearApiKey: vi.fn(() => 'linear-key'),
}));

vi.mock('../../../lib/cloister/work-agent-prompt.js', () => ({
  getTrackerContext: vi.fn(() => ({ apiKey: 'linear-key' })),
}));

vi.mock('../../../lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/config.js')>()),
  getDashboardApiUrlSync: vi.fn(() => 'http://dashboard.test'),
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

describe('resolveBareNumericIdSync rollout (PAN-1173)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    issueIdMocks.resolveBareNumericIdSync.mockReset();
    issueIdMocks.resolveBareNumericIdSync.mockReturnValue('PAN-9999');
    agentMocks.getAgentStateSync.mockReset();
    agentMocks.getAgentStateSync.mockReturnValue({
      issueId: 'PAN-9999',
      status: 'stopped',
      paused: true,
      troubled: true,
      consecutiveFailures: 1,
    });
    agentMocks.setAgentPausedSync.mockReset();
    agentMocks.clearAgentPausedSync.mockReset();
    agentMocks.clearAgentTroubledSync.mockReset();
    agentMocks.stopAgentSync.mockReset();
    tmuxMocks.sessionExistsSync.mockReset();
    tmuxMocks.sessionExistsSync.mockReturnValue(false);
    projectMocks.resolveProjectFromIssueSync.mockReset();
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project', projectKey: 'panopticon' });
    projectMocks.extractTeamPrefix.mockReset();
    projectMocks.extractTeamPrefix.mockReturnValue(null);
    projectMocks.findProjectByTeamSync.mockReset();
    projectMocks.findProjectByTeamSync.mockReturnValue(null);
    workspaceMocks.stopWorkspaceDocker.mockReset();
    workspaceMocks.stopWorkspaceDocker.mockReturnValue(Effect.succeed({ containersFound: false, steps: [] }));
    workspaceMocks.findWorkspacePath.mockReset();
    workspaceMocks.findWorkspacePath.mockReturnValue(null);
    interventionMocks.appendOperatorInterventionEvent.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);
    lifecycleMocks.closeOut.mockReset();
    lifecycleMocks.closeOut.mockReturnValue(Effect.succeed({ success: true, steps: [] }));
    inspectMocks.spawnInspectAgent.mockReset();
    inspectMocks.spawnInspectAgent.mockReturnValue(Effect.succeed({ success: true, tmuxSession: 'inspect-1', runId: 'run-1' }));
    inspectMocks.getDiffBase.mockReset();
    inspectMocks.getDiffBase.mockReturnValue(Effect.succeed('abcdef123456'));
    inspectMocks.getDiffStats.mockReset();
    inspectMocks.getDiffStats.mockReturnValue(Effect.succeed('1 file changed'));
    trackerMocks.resolveTrackerTypeSync.mockReset();
    trackerMocks.resolveTrackerTypeSync.mockReturnValue('rally');
    trackerMocks.isGitHubIssueSync.mockReset();
    trackerMocks.isGitHubIssueSync.mockReturnValue(true);
    trackerMocks.resolveGitHubIssueSync.mockReset();
    trackerMocks.resolveGitHubIssueSync.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'panopticon-cli', number: 9999 });
    fsMocks.existsSync.mockReset();
    fsMocks.existsSync.mockImplementation((path: string) => !path.endsWith('.panopticon.env'));
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
      json: async () => ({ success: true, message: 'ok' }),
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

    expect(issueIdMocks.resolveBareNumericIdSync).toHaveBeenCalledWith('9999');
    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('agent-pan-9999');
  });

  it('resolves bare numeric input before pan pause pauses the agent', async () => {
    const { pauseCommand } = await import('../pause.js');

    await pauseCommand('9999', { reason: 'operator' });

    expect(issueIdMocks.resolveBareNumericIdSync).toHaveBeenCalledWith('9999');
    expect(agentMocks.setAgentPausedSync).toHaveBeenCalledWith('agent-pan-9999', 'operator', false);
  });

  it('resolves bare numeric input before pan unpause clears the pause gate', async () => {
    const { unpauseCommand } = await import('../unpause.js');

    await unpauseCommand('9999');

    expect(issueIdMocks.resolveBareNumericIdSync).toHaveBeenCalledWith('9999');
    expect(agentMocks.clearAgentPausedSync).toHaveBeenCalledWith('agent-pan-9999');
  });

  it('resolves bare numeric input before pan untroubled clears the troubled gate', async () => {
    const { untroubledCommand } = await import('../untroubled.js');

    await untroubledCommand('9999');

    expect(issueIdMocks.resolveBareNumericIdSync).toHaveBeenCalledWith('9999');
    expect(agentMocks.clearAgentTroubledSync).toHaveBeenCalledWith('agent-pan-9999');
  });

  it('resolves bare numeric input before pan reopen resolves the tracker', async () => {
    const { reopenCommand } = await import('../reopen.js');

    await expect(reopenCommand('9999', { force: true })).rejects.toThrow('process.exit:1');

    expect(issueIdMocks.resolveBareNumericIdSync).toHaveBeenCalledWith('9999');
    expect(trackerMocks.resolveTrackerTypeSync).toHaveBeenCalledWith('PAN-9999');
  });

  it('resolves bare numeric input before pan close resolves the project', async () => {
    const { closeOutCommand } = await import('../close.js');

    await closeOutCommand('9999', { force: true, json: true });

    expect(issueIdMocks.resolveBareNumericIdSync).toHaveBeenCalledWith('9999');
    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-9999');
    expect(lifecycleMocks.closeOut).toHaveBeenCalledWith(expect.objectContaining({ issueId: 'PAN-9999' }));
  });

  it('resolves bare numeric input before pan inspect resolves the project', async () => {
    const { inspectCommand } = await import('../inspect.js');

    await inspectCommand('9999', { bead: 'workspace-abc' });

    expect(issueIdMocks.resolveBareNumericIdSync).toHaveBeenCalledWith('9999');
    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-9999');
    expect(inspectMocks.spawnInspectAgent).toHaveBeenCalledWith(expect.objectContaining({ issueId: 'PAN-9999' }), { deep: false });
  });

  it('resolves bare numeric input before pan open resolves the project', async () => {
    const { openCommand } = await import('../open.js');

    await openCommand('9999', { editor: 'code' });

    expect(issueIdMocks.resolveBareNumericIdSync).toHaveBeenCalledWith('9999');
    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-9999');
    expect(childProcessMocks.spawn).toHaveBeenCalledWith('code', ['/tmp/project/workspaces/feature-pan-9999'], expect.any(Object));
  });

  it('resolves bare numeric input before pan review restart resolves the project', async () => {
    const { reviewRestartCommand } = await import('../review-restart.js');

    await reviewRestartCommand('9999');

    expect(issueIdMocks.resolveBareNumericIdSync).toHaveBeenCalledWith('9999');
    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-9999');
    expect(fetch).toHaveBeenCalledWith('http://dashboard.test/api/specialists/panopticon/PAN-9999/review/restart', expect.any(Object));
  });

  it('prints the shared unresolved-ID error path for pan kill', async () => {
    issueIdMocks.resolveBareNumericIdSync.mockReturnValue(null);
    const { killCommand } = await import('../kill.js');

    await expect(killCommand('9999', {})).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not resolve issue ID "9999"'));
    expect(agentMocks.stopAgentSync).not.toHaveBeenCalled();
  });

  it('prints the shared unresolved-ID error path for pan pause', async () => {
    issueIdMocks.resolveBareNumericIdSync.mockReturnValue(null);
    const { pauseCommand } = await import('../pause.js');

    await expect(pauseCommand('9999', {})).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not resolve agent target "9999"'));
    expect(agentMocks.setAgentPausedSync).not.toHaveBeenCalled();
  });

  it('prints the shared unresolved-ID error path for pan review restart', async () => {
    issueIdMocks.resolveBareNumericIdSync.mockReturnValue(null);
    const { reviewRestartCommand } = await import('../review-restart.js');

    await expect(reviewRestartCommand('9999')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not resolve issue ID "9999"'));
    expect(projectMocks.resolveProjectFromIssueSync).not.toHaveBeenCalled();
  });
});
