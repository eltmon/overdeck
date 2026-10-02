/**
 * PAN-4465: pan pause accepts conversation numbers, names, and dashboard URLs
 * through the shared agent-target resolver, including the ambiguous-bare-
 * number refusal and the swarm-pause guidance fallback.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  setAgentPaused: vi.fn(),
  listAgentStates: vi.fn((): Array<{ id: string }> => []),
}));

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(() => false),
  listSessionNamesSync: vi.fn((): string[] => []),
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

vi.mock('../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/agents.js')>();
  return {
    ...actual,
    ...agentMocks,
    isQualifiedAgentId: isQualifiedAgentIdForTest,
    resolveAgentTarget: (target: string) => (isQualifiedAgentIdForTest(target) ? target.toLowerCase() : `agent-${target.toLowerCase()}`),
  };
});

vi.mock('../../../lib/terminal-backends/launch.js', () => ({
  agentPaneExists: vi.fn(async (id: string) => (tmuxMocks.sessionExistsSync as (name: string) => boolean)(id)),
}));

vi.mock('../../../lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tmux.js')>();
  return { ...actual, sessionExistsSync: tmuxMocks.sessionExistsSync, listSessionNamesSync: tmuxMocks.listSessionNamesSync };
});

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

const CONV_ROW = {
  id: 2972,
  name: '20260928-7563',
  tmuxSession: 'conv-20260928-7563',
  origin: 'local' as const,
  title: 'Fernkite deploy',
};

const RUNNING_STATE = { issueId: 'PAN-123', status: 'running' };

describe('pauseCommand conversation targets (PAN-4465)', () => {
  beforeEach(() => {
    agentMocks.setAgentPaused.mockReturnValue(Effect.succeed(null));
    vi.clearAllMocks();
    tmuxMocks.sessionExistsSync.mockReturnValue(false);
    tmuxMocks.listSessionNamesSync.mockReturnValue([]);
    agentMocks.listAgentStates.mockReturnValue([]);
    agentMocks.getAgentState.mockReturnValue(RUNNING_STATE);
    conversationMocks.getConversationById.mockReturnValue(null);
    conversationMocks.getConversationByName.mockReturnValue(null);
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
  });

  it('pauses the conversation agent for conv/2972', async () => {
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    const { pauseCommand } = await import('../pause.js');

    await pauseCommand('conv/2972', {});

    expect(agentMocks.setAgentPaused).toHaveBeenCalledWith('conv-20260928-7563', undefined, expect.any(Boolean), true);
  });

  it('exits 1 and never calls setAgentPaused for an ambiguous bare number', async () => {
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue(['PAN-2972']);
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    const { pauseCommand } = await import('../pause.js');

    await expect(pauseCommand('2972', {})).rejects.toThrow('process.exit:1');

    expect(agentMocks.setAgentPaused).not.toHaveBeenCalled();
  });

  it('still prints the swarm guidance for a swarm issue with no single agent', async () => {
    agentMocks.getAgentState.mockReturnValue(null);
    agentMocks.listAgentStates.mockReturnValue([
      { id: 'agent-pan-1791-slot-1' },
      { id: 'agent-pan-1791-slot-2' },
    ]);
    const { pauseCommand } = await import('../pause.js');

    await expect(pauseCommand('PAN-1791', {})).rejects.toThrow('process.exit:1');

    const stderr = vi.mocked(console.error).mock.calls.map((call) => call.join(' ')).join('\n');
    expect(stderr).toContain('pan swarm stop PAN-1791');
    expect(agentMocks.setAgentPaused).not.toHaveBeenCalled();
  });
});
