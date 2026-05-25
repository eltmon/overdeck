import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  clearAgentPausedSync: vi.fn(),
  clearAgentTroubledSync: vi.fn(),
  setAgentPausedSync: vi.fn(),
  stopAgentSync: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(),
}));

const remoteMocks = vi.hoisted(() => ({
  isRemoteAvailable: vi.fn(),
  killRemoteAgent: vi.fn(),
}));

const workspaceMocks = vi.hoisted(() => ({
  stopWorkspaceDocker: vi.fn(),
  findWorkspacePath: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  getIssuePrefix: vi.fn(),
}));

const issueIdMocks = vi.hoisted(() => ({
  resolveIssueIdSync: vi.fn((id: string) => id),
  extractPrefixSync: vi.fn((id: string) => id.split('-')[0]?.toUpperCase()),
}));

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const yamlMocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
  resetToTodo: vi.fn(),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(),
}));

vi.mock('../../../lib/agents.js', () => ({
  getAgentStateSync: agentMocks.getAgentStateSync,
  clearAgentPausedSync: agentMocks.clearAgentPausedSync,
  clearAgentTroubledSync: agentMocks.clearAgentTroubledSync,
  setAgentPausedSync: agentMocks.setAgentPausedSync,
  stopAgentSync: agentMocks.stopAgentSync,
}));

vi.mock('../../../lib/tmux.js', () => ({
  sessionExistsSync: tmuxMocks.sessionExistsSync,
}));

vi.mock('../../../lib/remote/index.js', () => ({
  isRemoteAvailable: remoteMocks.isRemoteAvailable,
}));

vi.mock('../../../lib/remote/remote-agents.js', () => ({
  killRemoteAgent: remoteMocks.killRemoteAgent,
}));

vi.mock('../../../lib/workspace-manager.js', () => ({
  stopWorkspaceDocker: workspaceMocks.stopWorkspaceDocker,
}));

vi.mock('../../../lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: workspaceMocks.findWorkspacePath,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: projectMocks.resolveProjectFromIssueSync,
  getIssuePrefix: projectMocks.getIssuePrefix,
}));

vi.mock('../../../lib/issue-id.js', () => ({
  resolveIssueIdSync: issueIdMocks.resolveIssueIdSync,
  extractPrefixSync: issueIdMocks.extractPrefixSync,
}));

vi.mock('fs', () => ({
  existsSync: fsMocks.existsSync,
  readFileSync: fsMocks.readFileSync,
}));

vi.mock('js-yaml', () => ({
  load: yamlMocks.load,
}));

vi.mock('../../../lib/lifecycle/index.js', () => ({
  resetToTodo: lifecycleMocks.resetToTodo,
}));

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

describe('operator intervention CLI emission', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    agentMocks.getAgentStateSync.mockReset();
    agentMocks.clearAgentPausedSync.mockReset();
    agentMocks.clearAgentTroubledSync.mockReset();
    agentMocks.setAgentPausedSync.mockReset();
    agentMocks.stopAgentSync.mockReset();
    tmuxMocks.sessionExistsSync.mockReset();
    remoteMocks.isRemoteAvailable.mockReset();
    remoteMocks.killRemoteAgent.mockReset();
    workspaceMocks.stopWorkspaceDocker.mockReset();
    workspaceMocks.findWorkspacePath.mockReset();
    projectMocks.resolveProjectFromIssueSync.mockReset();
    projectMocks.getIssuePrefix.mockReset();
    issueIdMocks.resolveIssueIdSync.mockReset();
    issueIdMocks.resolveIssueIdSync.mockImplementation((id: string) => id);
    issueIdMocks.extractPrefixSync.mockReset();
    issueIdMocks.extractPrefixSync.mockImplementation((id: string) => id.split('-')[0]?.toUpperCase());
    fsMocks.existsSync.mockReset();
    fsMocks.readFileSync.mockReset();
    yamlMocks.load.mockReset();
    lifecycleMocks.resetToTodo.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);
    workspaceMocks.stopWorkspaceDocker.mockReturnValue(Effect.succeed({ containersFound: false, steps: [] }));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    vi.resetModules();
  });

  it('emits a pause intervention when pan pause sets the pause gate', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ status: 'stopped' });
    tmuxMocks.sessionExistsSync.mockReturnValue(false);

    const { pauseCommand } = await import('../pause.js');
    await pauseCommand('PAN-1', { reason: 'operator requested' });

    expect(agentMocks.setAgentPausedSync).toHaveBeenCalledWith('agent-pan-1', 'operator requested', false);
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-1',
      kind: 'pause',
      source: 'pan pause',
    });
  });

  it('emits a pause intervention when pan kill stops a local agent', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ issueId: 'PAN-2', status: 'running' });
    tmuxMocks.sessionExistsSync.mockReturnValue(true);
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/project' });
    workspaceMocks.findWorkspacePath.mockReturnValue(null);

    const { killCommand } = await import('../kill.js');
    await killCommand('PAN-2', {});

    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('agent-pan-2');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-2',
      kind: 'pause',
      source: 'pan kill',
    });
  });

  it('tears down the issue workspace when pan kill stops a ship specialist (PAN-1326)', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({
      issueId: 'PAN-1326',
      status: 'running',
      role: 'ship',
      workspace: '/tmp/wrong-specialist-workspace',
    });
    tmuxMocks.sessionExistsSync.mockReturnValue(true);
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/panopticon-cli' });
    workspaceMocks.findWorkspacePath.mockReturnValue('/tmp/panopticon-cli/workspaces/feature-pan-1326');
    workspaceMocks.stopWorkspaceDocker.mockReturnValue(Effect.succeed({
      containersFound: true,
      steps: ['docker compose down', 'docker network prune'],
    }));

    const { killCommand } = await import('../kill.js');
    await killCommand('agent-pan-1326-ship', {});

    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-1326');
    expect(workspaceMocks.findWorkspacePath).toHaveBeenCalledWith('/tmp/panopticon-cli', 'pan-1326');
    expect(workspaceMocks.stopWorkspaceDocker).toHaveBeenCalledTimes(1);
    expect(workspaceMocks.stopWorkspaceDocker).toHaveBeenCalledWith('/tmp/panopticon-cli/workspaces/feature-pan-1326', 'pan-1326');
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('Stopped Docker stack: docker compose down; docker network prune'))).toBe(true);
  });

  it('tears down the issue workspace when pan kill stops a work agent (PAN-1326)', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({
      issueId: 'PAN-1316',
      status: 'running',
      role: 'work',
      workspace: '/tmp/wrong-workspace',
    });
    tmuxMocks.sessionExistsSync.mockReturnValue(true);
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/panopticon-cli' });
    workspaceMocks.findWorkspacePath.mockReturnValue('/tmp/panopticon-cli/workspaces/feature-pan-1316');
    workspaceMocks.stopWorkspaceDocker.mockReturnValue(Effect.succeed({
      containersFound: true,
      steps: ['docker compose down', 'docker network prune'],
    }));

    const { killCommand } = await import('../kill.js');
    await killCommand('agent-pan-1316', {});

    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-1316');
    expect(workspaceMocks.findWorkspacePath).toHaveBeenCalledWith('/tmp/panopticon-cli', 'pan-1316');
    expect(workspaceMocks.stopWorkspaceDocker).toHaveBeenCalledTimes(1);
    expect(workspaceMocks.stopWorkspaceDocker).toHaveBeenCalledWith('/tmp/panopticon-cli/workspaces/feature-pan-1316', 'pan-1316');
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('Stopped Docker stack: docker compose down; docker network prune'))).toBe(true);
  });

  it('emits a deep-wipe intervention when pan wipe succeeds', async () => {
    fsMocks.existsSync.mockImplementation((path: string) => path.endsWith('projects.yaml'));
    fsMocks.readFileSync.mockReturnValue('projects: {}');
    yamlMocks.load.mockReturnValue({ projects: { panopticon: { path: '/tmp/project', linear_team: 'PAN' } } });
    projectMocks.getIssuePrefix.mockReturnValue('PAN');
    lifecycleMocks.resetToTodo.mockReturnValue(Effect.succeed({ success: true, steps: [] }));

    const { wipeCommand } = await import('../wipe.js');
    await wipeCommand('PAN-3', { yes: true });

    expect(lifecycleMocks.resetToTodo).toHaveBeenCalledWith({
      issueId: 'PAN-3',
      projectPath: '/tmp/project',
      projectName: '',
    }, {
      deleteWorkspace: true,
      deleteBranches: true,
      resetIssue: true,
    });
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-3',
      kind: 'deep_wipe',
      source: 'pan wipe',
    });
  });

  it('does not emit a deep-wipe intervention when pan wipe fails', async () => {
    fsMocks.existsSync.mockImplementation((path: string) => path.endsWith('projects.yaml'));
    fsMocks.readFileSync.mockReturnValue('projects: {}');
    yamlMocks.load.mockReturnValue({ projects: { panopticon: { path: '/tmp/project', linear_team: 'PAN' } } });
    projectMocks.getIssuePrefix.mockReturnValue('PAN');
    lifecycleMocks.resetToTodo.mockReturnValue(Effect.succeed({ success: false, steps: [] }));

    const { wipeCommand } = await import('../wipe.js');
    await wipeCommand('PAN-3', { yes: true });

    expect(interventionMocks.appendOperatorInterventionEvent).not.toHaveBeenCalled();
  });

  it('emits an unpause intervention when pan unpause clears a pause gate', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ paused: true });

    const { unpauseCommand } = await import('../unpause.js');
    await unpauseCommand('PAN-1');

    expect(agentMocks.clearAgentPausedSync).toHaveBeenCalledWith('agent-pan-1');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-1',
      kind: 'unpause',
      source: 'pan unpause',
    });
  });

  it('does not emit an unpause intervention when the agent was already unpaused', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ paused: false });

    const { unpauseCommand } = await import('../unpause.js');
    await unpauseCommand('PAN-1');

    expect(interventionMocks.appendOperatorInterventionEvent).not.toHaveBeenCalled();
  });

  it('emits an untroubled intervention when pan untroubled clears a troubled gate', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ troubled: false, consecutiveFailures: 2 });

    const { untroubledCommand } = await import('../untroubled.js');
    await untroubledCommand('PAN-2');

    expect(agentMocks.clearAgentTroubledSync).toHaveBeenCalledWith('agent-pan-2');
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-2',
      kind: 'untroubled',
      source: 'pan untroubled',
    });
  });

  it('does not emit an untroubled intervention when the agent was already untroubled', async () => {
    agentMocks.getAgentStateSync.mockReturnValue({ troubled: false, consecutiveFailures: 0 });

    const { untroubledCommand } = await import('../untroubled.js');
    await untroubledCommand('PAN-2');

    expect(interventionMocks.appendOperatorInterventionEvent).not.toHaveBeenCalled();
  });
});
