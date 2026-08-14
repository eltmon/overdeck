import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

/**
 * PAN-3728: `pan kill <qualified-agent-id>` used to run the issue-wide Docker
 * teardown, stopping the shared `overdeck-feature-<issue>-*` compose stack out
 * from under sibling agents that were still working in the same workspace.
 */

const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  stopAgentSync: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(),
}));

const remoteMocks = vi.hoisted(() => ({
  isRemoteAvailable: vi.fn(),
  killRemoteAgent: vi.fn(),
  loadRemoteAgentState: vi.fn(),
}));

const workspaceMocks = vi.hoisted(() => ({
  stopWorkspaceDocker: vi.fn(),
  findWorkspacePath: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
}));

const issueIdMocks = vi.hoisted(() => ({
  resolveBareNumericIdSync: vi.fn((id: string) => id.toUpperCase()),
}));

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(),
}));

vi.mock('../../../lib/agents.js', () => {
  // Mirror the real prefix routing (PAN-1760) so single-agent targeting stays
  // under test while the heavy agents module remains mocked.
  const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-', 'strike-', 'inspect-'];
  const isQualifiedAgentId = (input: string) => {
    const lower = input.toLowerCase();
    return lower === 'flywheel-orchestrator' || AGENT_PREFIXES.some(p => lower.startsWith(p));
  };
  return {
    getAgentStateSync: agentMocks.getAgentStateSync,
    stopAgentSync: agentMocks.stopAgentSync,
    isQualifiedAgentId,
  };
});

vi.mock('../../../lib/tmux.js', () => ({
  sessionExistsSync: tmuxMocks.sessionExistsSync,
}));

vi.mock('../../../lib/remote/index.js', () => ({
  isRemoteAvailable: remoteMocks.isRemoteAvailable,
}));

vi.mock('../../../lib/remote/remote-agents.js', () => ({
  killRemoteAgent: remoteMocks.killRemoteAgent,
  loadRemoteAgentState: remoteMocks.loadRemoteAgentState,
}));

vi.mock('../../../lib/workspace-manager.js', () => ({
  stopWorkspaceDocker: workspaceMocks.stopWorkspaceDocker,
}));

vi.mock('../../../lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: workspaceMocks.findWorkspacePath,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: projectMocks.resolveProjectFromIssueSync,
}));

vi.mock('../../../lib/issue-id.js', () => ({
  resolveBareNumericIdSync: issueIdMocks.resolveBareNumericIdSync,
}));

vi.mock('fs', () => ({
  existsSync: fsMocks.existsSync,
  readdirSync: fsMocks.readdirSync,
}));

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

/** Only the listed agent ids have a live tmux session. */
function liveSessions(...ids: string[]): void {
  const live = new Set(ids);
  tmuxMocks.sessionExistsSync.mockImplementation((id: string) => live.has(id));
}

function skipLines(logSpy: ReturnType<typeof vi.spyOn>): string[] {
  return logSpy.mock.calls
    .map(([message]) => String(message))
    .filter(message => message.includes('Skipping Docker teardown'));
}

describe('killCommand Docker teardown (PAN-3728)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    agentMocks.getAgentStateSync.mockReset();
    agentMocks.stopAgentSync.mockReset();
    tmuxMocks.sessionExistsSync.mockReset();
    remoteMocks.isRemoteAvailable.mockReset();
    remoteMocks.killRemoteAgent.mockReset();
    remoteMocks.loadRemoteAgentState.mockReset();
    remoteMocks.loadRemoteAgentState.mockReturnValue(null);
    workspaceMocks.stopWorkspaceDocker.mockReset();
    workspaceMocks.findWorkspacePath.mockReset();
    projectMocks.resolveProjectFromIssueSync.mockReset();
    issueIdMocks.resolveBareNumericIdSync.mockReset();
    issueIdMocks.resolveBareNumericIdSync.mockImplementation((id: string) => id.toUpperCase());
    fsMocks.existsSync.mockReset();
    fsMocks.readdirSync.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockReset();
    interventionMocks.appendOperatorInterventionEvent.mockResolvedValue(undefined);

    // Agent state dir exists; both the sibling scan and issue-wide discovery
    // read the same directory listing, so this must not be a one-shot mock.
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readdirSync.mockReturnValue(['agent-pan-3680', 'agent-pan-3680-test']);
    agentMocks.getAgentStateSync.mockImplementation((agentId: string) => ({
      issueId: 'PAN-3680',
      status: 'running',
      role: agentId.endsWith('-test') ? 'test' : 'work',
    }));
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/tmp/overdeck' });
    workspaceMocks.findWorkspacePath.mockReturnValue('/tmp/overdeck/workspaces/feature-pan-3680');
    workspaceMocks.stopWorkspaceDocker.mockReturnValue(Effect.succeed({
      containersFound: true,
      steps: ['docker compose down'],
    }));

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

  it('skips teardown when a live sibling agent still uses the workspace', async () => {
    liveSessions('agent-pan-3680', 'agent-pan-3680-test');

    const { killCommand } = await import('../kill.js');
    await killCommand('agent-pan-3680-test', {});

    // The kill itself still happens — only the shared stack is left alone.
    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('agent-pan-3680-test', 'operator');
    expect(agentMocks.stopAgentSync).toHaveBeenCalledTimes(1);
    expect(interventionMocks.appendOperatorInterventionEvent).toHaveBeenCalledWith({
      issueId: 'PAN-3680',
      kind: 'pause',
      source: 'pan kill',
    });

    expect(workspaceMocks.stopWorkspaceDocker).not.toHaveBeenCalled();
    const skips = skipLines(logSpy);
    expect(skips).toHaveLength(1);
    expect(skips[0]).toContain('agent-pan-3680');
  });

  it('tears down the stack when the sibling directory exists but its session is gone', async () => {
    // state.json can claim "running" after a session dies — session existence,
    // not stored status, decides whether the stack is still in use.
    liveSessions('agent-pan-3680-test');

    const { killCommand } = await import('../kill.js');
    await killCommand('agent-pan-3680-test', {});

    expect(workspaceMocks.stopWorkspaceDocker).toHaveBeenCalledTimes(1);
    expect(workspaceMocks.stopWorkspaceDocker).toHaveBeenCalledWith(
      '/tmp/overdeck/workspaces/feature-pan-3680',
      'pan-3680',
    );
    expect(skipLines(logSpy)).toHaveLength(0);
  });

  it('tears down the stack on an issue-wide kill, which leaves no siblings behind', async () => {
    liveSessions('agent-pan-3680', 'agent-pan-3680-test');

    const { killCommand } = await import('../kill.js');
    await killCommand('PAN-3680', {});

    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('agent-pan-3680', 'operator');
    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('agent-pan-3680-test', 'operator');
    expect(workspaceMocks.stopWorkspaceDocker).toHaveBeenCalledTimes(1);
    expect(workspaceMocks.stopWorkspaceDocker).toHaveBeenCalledWith(
      '/tmp/overdeck/workspaces/feature-pan-3680',
      'pan-3680',
    );
    expect(skipLines(logSpy)).toHaveLength(0);
  });
});
