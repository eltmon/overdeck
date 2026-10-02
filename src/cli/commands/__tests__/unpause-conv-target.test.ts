/**
 * PAN-4465: pan unpause accepts conversation numbers, names, and dashboard
 * URLs through the shared agent-target resolver, including the ambiguous-
 * bare-number refusal.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  clearAgentPaused: vi.fn(),
}));

const interventionMocks = vi.hoisted(() => ({
  appendOperatorInterventionEvent: vi.fn(async () => {}),
}));

const unpauseMocks = vi.hoisted(() => ({
  getWorkAgentLifecycleState: vi.fn(async () => ({ canResumeSession: false })),
  resumeAgent: vi.fn(async () => ({ success: true })),
}));

const lifecycleMocks = vi.hoisted(() => ({
  restartIssueAfterUnpause: vi.fn(async () => null),
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

vi.mock('../../../lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: interventionMocks.appendOperatorInterventionEvent,
}));

vi.mock('../../../lib/work-agent-lifecycle.js', () => ({
  getWorkAgentLifecycleState: unpauseMocks.getWorkAgentLifecycleState,
}));

vi.mock('../../../lib/agents/resume.js', () => ({
  resumeAgent: unpauseMocks.resumeAgent,
}));

vi.mock('../../../lib/agents/issue-pause.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/agents/issue-pause.js')>();
  return { ...actual, restartIssueAfterUnpause: lifecycleMocks.restartIssueAfterUnpause };
});

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

const PAUSED_STATE = { issueId: 'PAN-123', status: 'stopped', paused: true };

describe('unpauseCommand conversation targets (PAN-4465)', () => {
  beforeEach(() => {
    agentMocks.clearAgentPaused.mockReturnValue(Effect.succeed(null));
    vi.clearAllMocks();
    agentMocks.clearAgentPaused.mockReturnValue(Effect.succeed(null));
    agentMocks.getAgentState.mockReturnValue(PAUSED_STATE);
    conversationMocks.getConversationById.mockReturnValue(null);
    conversationMocks.getConversationByName.mockReturnValue(null);
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue([]);
    unpauseMocks.getWorkAgentLifecycleState.mockResolvedValue({ canResumeSession: false });
    lifecycleMocks.restartIssueAfterUnpause.mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
  });

  it('clears the pause gate for the conversation agent for conv/2972', async () => {
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    const { unpauseCommand } = await import('../unpause.js');

    await unpauseCommand('conv/2972');

    expect(agentMocks.clearAgentPaused).toHaveBeenCalledWith('conv-20260928-7563');
  });

  it('exits 1 and never calls clearAgentPaused for an ambiguous bare number', async () => {
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue(['PAN-2972']);
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    const { unpauseCommand } = await import('../unpause.js');

    await expect(unpauseCommand('2972')).rejects.toThrow('process.exit:1');

    expect(agentMocks.clearAgentPaused).not.toHaveBeenCalled();
  });
});
