/**
 * PAN-4465: pan untroubled accepts conversation numbers, names, and
 * dashboard URLs through the shared agent-target resolver, including the
 * unresolved-target refusal.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  clearAgentTroubled: vi.fn(),
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

const TROUBLED_STATE = { issueId: 'PAN-123', status: 'stopped', troubled: true };

describe('untroubledCommand conversation targets (PAN-4465)', () => {
  beforeEach(() => {
    agentMocks.clearAgentTroubled.mockReturnValue(Effect.succeed(null));
    vi.clearAllMocks();
    agentMocks.clearAgentTroubled.mockReturnValue(Effect.succeed(null));
    agentMocks.getAgentState.mockReturnValue(TROUBLED_STATE);
    conversationMocks.getConversationById.mockReturnValue(null);
    conversationMocks.getConversationByName.mockReturnValue(null);
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue([]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
  });

  it('clears the troubled state for the conversation agent for conv/2972', async () => {
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    const { untroubledCommand } = await import('../untroubled.js');

    await untroubledCommand('conv/2972');

    expect(agentMocks.clearAgentTroubled).toHaveBeenCalledWith('conv-20260928-7563');
  });

  it('exits 1 and prints the accepted target forms for an unresolved target', async () => {
    const { untroubledCommand } = await import('../untroubled.js');

    await expect(untroubledCommand('conv/9999')).rejects.toThrow('process.exit:1');

    expect(agentMocks.clearAgentTroubled).not.toHaveBeenCalled();
    const stderr = vi.mocked(console.error).mock.calls.map((call) => call.join(' ')).join('\n');
    expect(stderr).toContain('no conversation 9999');
    expect(stderr).toContain('Accepted targets:');
    expect(stderr).toContain('conv/2972, conv:2972');
  });
});
