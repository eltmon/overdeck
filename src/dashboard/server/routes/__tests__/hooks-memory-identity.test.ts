import { describe, expect, it, vi } from 'vitest';
import type { LegacyConversation } from '../../../../lib/overdeck/conversations.js';
import type { WorkspaceRow } from '../../../../lib/workspaces/types.js';

const mocks = vi.hoisted(() => ({
  getConversationByClaudeSessionId: vi.fn(),
  getConversationByTmuxSession: vi.fn(),
  getWorkspaceById: vi.fn(),
  resolveWorkspaceForCwd: vi.fn(),
  getAgentState: vi.fn(),
}));

vi.mock('../../../../lib/overdeck/conversations.js', async () => {
  const actual = await vi.importActual('../../../../lib/overdeck/conversations.js');
  return {
    ...(actual as object),
    getConversationByClaudeSessionId: mocks.getConversationByClaudeSessionId,
    getConversationByTmuxSession: mocks.getConversationByTmuxSession,
  };
});

vi.mock('../../../../lib/workspaces/resolver.js', async () => {
  const actual = await vi.importActual('../../../../lib/workspaces/resolver.js');
  return {
    ...(actual as object),
    getWorkspaceById: mocks.getWorkspaceById,
    resolveWorkspaceForCwd: mocks.resolveWorkspaceForCwd,
  };
});

vi.mock('../../../../lib/agents.js', async () => {
  const actual = await vi.importActual('../../../../lib/agents.js');
  return {
    ...(actual as object),
    getAgentState: mocks.getAgentState,
  };
});

const { handleMemoryInjectBody } = await import('../hooks.js');

function conversation(overrides: Partial<LegacyConversation> = {}): LegacyConversation {
  return {
    id: 1,
    name: 'conv-main',
    tmuxSession: 'conv-main',
    status: 'active',
    cwd: '/home/eltmon/Projects/overdeck',
    issueId: null,
    createdAt: '2026-11-15T00:00:00Z',
    endedAt: null,
    lastAttachedAt: null,
    claudeSessionId: 'claude-sess-1',
    title: null,
    titleSource: null,
    titleSeed: null,
    totalCost: 0,
    totalTokens: 0,
    archivedAt: null,
    model: null,
    effort: null,
    forkStatus: null,
    forkError: null,
    harness: 'claude-code',
    deliveryMethod: null,
    spawnError: null,
    handoffDocPath: null,
    handoffTargetConvId: null,
    forkFallbackReason: null,
    clearedToConvId: null,
    forkRequest: null,
    forkRetryCount: 0,
    workspaceId: 'ws-main',
    projectKey: null,
    bareContext: false,
    ...overrides,
  } as LegacyConversation;
}

function workspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  return {
    id: 'ws-main',
    projectId: 'overdeck',
    kind: 'main',
    origin: 'operator',
    name: 'main',
    path: '/home/eltmon/Projects/overdeck',
    branchName: null,
    parentBranch: null,
    parentBranchGuessed: false,
    isGitRepository: true,
    issueId: null,
    layoutConfig: null,
    runCommand: null,
    ...overrides,
  } as WorkspaceRow;
}

describe('memory identity resolution for conversations (PAN-5359)', () => {
  it('resolves a project-root Claude conversation through the main workspace row', async () => {
    mocks.getAgentState.mockReturnValue(null);
    mocks.getConversationByClaudeSessionId.mockReturnValue(conversation());
    mocks.getConversationByTmuxSession.mockReturnValue(null);
    mocks.getWorkspaceById.mockReturnValue(workspace());
    mocks.resolveWorkspaceForCwd.mockReturnValue(null);

    const injectMemory = vi.fn(async () => ({ status: 'injected' as const, context: '', decision: {} as never }));

    await handleMemoryInjectBody(
      { prompt: 'how does delivery work', sessionId: 'claude-sess-1' },
      {
        injectMemory,
        injectBriefing: async (input) => ({ context: input.context, injected: false, briefingMtimeMs: null }),
        resolveComplianceWarning: async () => null,
        resolveAgentIdBySessionId: async () => null,
      },
    );

    expect(injectMemory).toHaveBeenCalledTimes(1);
    expect(injectMemory.mock.calls[0]![0].identity).toEqual({
      projectId: 'overdeck',
      workspaceId: 'ws-main',
      issueId: null,
      runId: 'conv-main',
      sessionId: 'claude-sess-1',
      agentRole: 'conversation',
      agentHarness: 'claude-code',
    });
  });

  it('resolves a Codex conversation by its conversation name when the session id is unrecorded', async () => {
    mocks.getAgentState.mockReturnValue(null);
    mocks.getConversationByClaudeSessionId.mockReturnValue(null);
    mocks.getConversationByTmuxSession.mockReturnValue(conversation({
      name: 'conv-c1',
      tmuxSession: 'conv-c1',
      claudeSessionId: null,
      harness: 'codex',
    }));
    mocks.getWorkspaceById.mockReturnValue(workspace());
    mocks.resolveWorkspaceForCwd.mockReturnValue(null);

    const injectMemory = vi.fn(async () => ({ status: 'injected' as const, context: '', decision: {} as never }));

    await handleMemoryInjectBody(
      { prompt: 'how does delivery work', sessionId: '01a1-thread', agentId: 'conv-c1', conversation: 'conv-c1' },
      {
        injectMemory,
        injectBriefing: async (input) => ({ context: input.context, injected: false, briefingMtimeMs: null }),
        resolveComplianceWarning: async () => null,
        resolveAgentIdBySessionId: async () => null,
      },
    );

    expect(mocks.getAgentState).toHaveBeenCalledWith('conv-c1');
    expect(mocks.getConversationByClaudeSessionId).toHaveBeenCalledWith('01a1-thread');
    expect(mocks.getConversationByTmuxSession).toHaveBeenCalledWith('conv-c1');
    expect(injectMemory).toHaveBeenCalledTimes(1);
    expect(injectMemory.mock.calls[0]![0].identity).toMatchObject({
      agentHarness: 'codex',
      runId: 'conv-c1',
    });
  });

  it('returns a 202 and never calls injectMemory when neither lookup resolves', async () => {
    mocks.getAgentState.mockReturnValue(null);
    mocks.getConversationByClaudeSessionId.mockReturnValue(null);
    mocks.getConversationByTmuxSession.mockReturnValue(null);
    mocks.getWorkspaceById.mockReturnValue(null);
    mocks.resolveWorkspaceForCwd.mockReturnValue(null);

    const injectMemory = vi.fn(async () => ({ status: 'injected' as const, context: '', decision: {} as never }));

    const result = await handleMemoryInjectBody(
      { prompt: 'how does delivery work', sessionId: 'unresolvable-session' },
      {
        injectMemory,
        injectBriefing: async (input) => ({ context: input.context, injected: false, briefingMtimeMs: null }),
        resolveComplianceWarning: async () => null,
        resolveAgentIdBySessionId: async () => null,
      },
    );

    expect(result).toEqual({ error: 'memory identity could not be resolved', status: 202 });
    expect(injectMemory).not.toHaveBeenCalled();
  });
});
