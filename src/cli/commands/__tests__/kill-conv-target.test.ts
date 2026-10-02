/**
 * PAN-4465: pan kill accepts conversation numbers, names, and dashboard URLs
 * through the shared agent-target resolver, including the ambiguous-bare-
 * number refusal, while an issue ID keeps the existing issue-wide fan-out.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  stopAgent: vi.fn(),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(() => false),
}));

const remoteMocks = vi.hoisted(() => ({
  isRemoteAvailable: vi.fn(async () => ({ available: false, reason: 'test' })),
  killRemoteAgent: vi.fn(async () => {}),
  loadRemoteAgentState: vi.fn(() => null),
}));

const workspaceMocks = vi.hoisted(() => ({
  stopWorkspaceDocker: vi.fn(async () => ({ containersFound: false, steps: [] as string[] })),
  findWorkspacePath: vi.fn(() => null),
}));

const projectMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(async () => {}),
}));

const conversationMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getConversationByName: vi.fn(() => null),
}));

const issueIdMocks = vi.hoisted(() => ({
  listBareNumericIssueMatches: vi.fn(() => [] as string[]),
}));

const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-', 'strike-', 'inspect-'];
const isQualifiedAgentIdForTest = (input: string): boolean => {
  const lower = input.toLowerCase();
  return lower === 'flywheel-orchestrator' || AGENT_PREFIXES.some((p) => lower.startsWith(p));
};

vi.mock('../../../lib/agents.js', () => ({
  getAgentState: agentMocks.getAgentState,
  stopAgent: agentMocks.stopAgent,
  isQualifiedAgentId: isQualifiedAgentIdForTest,
}));

vi.mock('../../../lib/terminal-backends/launch.js', () => ({
  agentPaneExists: vi.fn(async (id: string) => (tmuxMocks.sessionExistsSync as (name: string) => boolean)(id)),
}));

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

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

vi.mock('../../../lib/overdeck/conversations.js', () => ({
  getConversationById: conversationMocks.getConversationById,
  getConversationByName: conversationMocks.getConversationByName,
}));

vi.mock('../../../lib/issue-id.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/issue-id.js')>();
  return {
    ...actual,
    listBareNumericIssueMatches: issueIdMocks.listBareNumericIssueMatches,
  };
});

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}));

const CONV_ROW = {
  id: 2972,
  name: '20260928-7563',
  tmuxSession: 'conv-20260928-7563',
  origin: 'local' as const,
  title: 'Fernkite deploy',
};

describe('killCommand conversation targets (PAN-4465)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentMocks.getAgentState.mockReturnValue(null);
    agentMocks.stopAgent.mockReturnValue(Effect.void);
    tmuxMocks.sessionExistsSync.mockReturnValue(false);
    remoteMocks.loadRemoteAgentState.mockReturnValue(null);
    conversationMocks.getConversationById.mockReturnValue(null);
    conversationMocks.getConversationByName.mockReturnValue(null);
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
  });

  it('stops exactly the conversation agent for conv/2972', async () => {
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    tmuxMocks.sessionExistsSync.mockImplementation((id: string) => id === 'conv-20260928-7563');
    const { killCommand } = await import('../kill.js');

    await killCommand('conv/2972', {});

    expect(agentMocks.stopAgent).toHaveBeenCalledTimes(1);
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('conv-20260928-7563', 'operator');
  });

  it('exits 1 and calls stopAgent zero times for an ambiguous bare number', async () => {
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue(['PAN-2972']);
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    const { killCommand } = await import('../kill.js');

    await expect(killCommand('2972', {})).rejects.toThrow('process.exit:1');

    expect(agentMocks.stopAgent).not.toHaveBeenCalled();
  });

  it('keeps the issue-wide fan-out for an issue ID', async () => {
    agentMocks.getAgentState.mockReturnValue({ issueId: 'PAN-1148' });
    tmuxMocks.sessionExistsSync.mockImplementation((id: string) => id === 'agent-pan-1148');
    const { killCommand } = await import('../kill.js');

    await killCommand('PAN-1148', {});

    expect(agentMocks.stopAgent).toHaveBeenCalledWith('agent-pan-1148', 'operator');
  });
});
