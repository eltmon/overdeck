/**
 * PAN-4465: pan tell accepts conversation numbers, names, and dashboard URLs
 * through the shared agent-target resolver, including the ambiguous-bare-
 * number refusal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  messageAgent: vi.fn(async () => ({ delivered: true, queuedToMail: false })),
}));

const remoteMocks = vi.hoisted(() => ({
  loadRemoteAgentState: vi.fn(() => null),
  sendToRemoteAgent: vi.fn(async () => {}),
}));

const conversationMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getConversationByName: vi.fn(() => null),
}));

const issueIdMocks = vi.hoisted(() => ({
  listBareNumericIssueMatches: vi.fn(() => [] as string[]),
}));

const exitMocks = vi.hoisted(() => ({
  exitCli: vi.fn(async (_code: number) => undefined as never),
}));

vi.mock('../../../lib/agents.js', () => ({
  isQualifiedAgentId: (id: string) => id.toLowerCase().startsWith('conv-'),
  resolveAgentTarget: (id: string) => id.toLowerCase(),
  getAgentState: (id: string) => ({ id, issueId: 'PAN-123' }),
  messageAgent: agentMocks.messageAgent,
}));

vi.mock('../../../lib/work-agent-lifecycle.js', () => ({
  issueOwesRework: vi.fn(async () => false),
}));

vi.mock('../../exit.js', () => ({
  exitCli: exitMocks.exitCli,
}));

vi.mock('../../../lib/remote/index.js', () => ({
  loadRemoteAgentState: remoteMocks.loadRemoteAgentState,
  sendToRemoteAgent: remoteMocks.sendToRemoteAgent,
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
  laneRole: null,
  title: 'Fernkite deploy',
};

describe('tellCommand conversation targets (PAN-4465)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentMocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
    remoteMocks.loadRemoteAgentState.mockReturnValue(null);
    conversationMocks.getConversationById.mockReturnValue(null);
    conversationMocks.getConversationByName.mockReturnValue(null);
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue([]);
  });

  it.each([
    'conv/2972',
    'https://overdeck.localhost/conv/2972',
  ])('delivers to the conversation agent for %s', async (id) => {
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    const { tellCommand } = await import('../tell.js');

    await tellCommand(id, 'hello conversation');

    expect(agentMocks.messageAgent).toHaveBeenCalledWith(
      'conv-20260928-7563',
      'hello conversation',
      'pan-tell',
      expect.any(Object),
    );
  });

  it('delivers to the conversation agent for an unambiguous bare number', async () => {
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue([]);
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    const { tellCommand } = await import('../tell.js');

    await tellCommand('2972', 'hello conversation');

    expect(agentMocks.messageAgent).toHaveBeenCalledWith(
      'conv-20260928-7563',
      'hello conversation',
      'pan-tell',
      expect.any(Object),
    );
  });

  it('exits 1, prints both explicit forms, and never calls messageAgent for an ambiguous bare number', async () => {
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue(['PAN-2972']);
    conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { tellCommand } = await import('../tell.js');

    await tellCommand('2972', 'hello conversation');

    expect(exitMocks.exitCli).toHaveBeenCalledWith(1);
    expect(agentMocks.messageAgent).not.toHaveBeenCalled();
    const printed = errorSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(printed).toContain('PAN-2972');
    expect(printed).toContain('conv/2972');
    errorSpy.mockRestore();
  });
});
