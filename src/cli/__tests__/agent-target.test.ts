import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const conversationMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getConversationByName: vi.fn(),
}));

const issueIdMocks = vi.hoisted(() => ({
  listBareNumericIssueMatches: vi.fn(),
}));

vi.mock('../../lib/overdeck/conversations.js', () => ({
  getConversationById: conversationMocks.getConversationById,
  getConversationByName: conversationMocks.getConversationByName,
}));

vi.mock('../../lib/issue-id.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/issue-id.js')>();
  return {
    ...actual,
    listBareNumericIssueMatches: issueIdMocks.listBareNumericIssueMatches,
  };
});

vi.mock('../../lib/agents.js', () => {
  // Mirror the real prefix routing (PAN-1760) so agent-id detection stays
  // under test while the heavy agents module remains mocked.
  const AGENT_PREFIXES = ['agent-', 'planning-', 'conv-', 'strike-', 'inspect-'];
  const isQualifiedAgentId = (input: string) => {
    const lower = input.toLowerCase();
    return lower === 'flywheel-orchestrator' || AGENT_PREFIXES.some((p) => lower.startsWith(p));
  };
  return {
    isQualifiedAgentId,
    resolveAgentTarget: vi.fn((input: string) =>
      isQualifiedAgentId(input) ? input.toLowerCase() : `agent-${input.toLowerCase()}`),
  };
});

const CONV_ROW = {
  id: 2972,
  name: '20260928-7563',
  tmuxSession: 'conv-20260928-7563',
  origin: 'local' as const,
  title: 'Fernkite deploy',
};

const VAULT_ROW = {
  id: 9999,
  name: '20260101-0001',
  tmuxSession: 'conv-20260101-0001',
  origin: 'vault' as const,
  title: null,
};

describe('agent-target (PAN-4465)', () => {
  beforeEach(() => {
    conversationMocks.getConversationById.mockReset();
    conversationMocks.getConversationByName.mockReset();
    conversationMocks.getConversationById.mockReturnValue(null);
    conversationMocks.getConversationByName.mockReturnValue(null);
    issueIdMocks.listBareNumericIssueMatches.mockReset();
    issueIdMocks.listBareNumericIssueMatches.mockReturnValue([]);
  });

  describe('resolveCliAgentTarget — explicit conversation forms', () => {
    it.each([
      'conv/2972',
      'conv:2972',
      'https://overdeck.localhost/conv/2972',
      'https://overdeck.localhost/conv/2972?view=terminal&views=2972%3Aterminal',
      'http://localhost:3011/conv/2972/',
    ])('resolves %s to the conversation agent', async (input) => {
      conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget(input);

      expect(conversationMocks.getConversationById).toHaveBeenCalledWith(2972);
      expect(result).toEqual({ kind: 'agent', agentId: 'conv-20260928-7563', via: 'conversation' });
    });

    it('resolves a conversation name via conv/<name>', async () => {
      conversationMocks.getConversationByName.mockReturnValue(CONV_ROW);
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('conv/20260928-7563');

      expect(conversationMocks.getConversationByName).toHaveBeenCalledWith('20260928-7563');
      expect(result).toEqual({ kind: 'agent', agentId: 'conv-20260928-7563', via: 'conversation' });
    });

    it('returns unresolved when the conversation row is missing', async () => {
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('conv/9999');

      expect(result).toEqual({ kind: 'unresolved', input: 'conv/9999', reason: 'no conversation 9999' });
    });

    it('returns unresolved for a Session Vault row and never falls back to an issue', async () => {
      conversationMocks.getConversationById.mockReturnValue(VAULT_ROW);
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('conv/9999');

      expect(result).toEqual({
        kind: 'unresolved',
        input: 'conv/9999',
        reason: 'conversation 9999 is a Session Vault copy and has no live agent',
      });
    });

    it('treats conv-20260928-7563 as an agent ID, not a conversation form', async () => {
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('conv-20260928-7563');

      expect(conversationMocks.getConversationById).not.toHaveBeenCalled();
      expect(conversationMocks.getConversationByName).not.toHaveBeenCalled();
      expect(result).toEqual({ kind: 'agent', agentId: 'conv-20260928-7563', via: 'agent-id' });
    });
  });

  describe('resolveCliAgentTarget — bare digits', () => {
    it('resolves to the conversation when there is no issue candidate', async () => {
      issueIdMocks.listBareNumericIssueMatches.mockReturnValue([]);
      conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('2972');

      expect(result).toEqual({ kind: 'agent', agentId: 'conv-20260928-7563', via: 'conversation' });
    });

    it('resolves to the issue when there is one issue candidate and no conversation', async () => {
      issueIdMocks.listBareNumericIssueMatches.mockReturnValue(['PAN-2972']);
      conversationMocks.getConversationById.mockReturnValue(null);
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('2972');

      expect(result).toEqual({ kind: 'issue', issueId: 'PAN-2972' });
    });

    it('is ambiguous with one issue candidate and a conversation', async () => {
      issueIdMocks.listBareNumericIssueMatches.mockReturnValue(['PAN-2972']);
      conversationMocks.getConversationById.mockReturnValue(CONV_ROW);
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('2972');

      expect(result).toEqual({
        kind: 'ambiguous',
        input: '2972',
        candidates: [
          { explicitForm: 'PAN-2972', label: 'issue PAN-2972' },
          { explicitForm: 'conv/2972', label: 'conversation 2972 "Fernkite deploy" (conv-20260928-7563)' },
        ],
      });
    });

    it('is ambiguous with two issue candidates and no conversation', async () => {
      issueIdMocks.listBareNumericIssueMatches.mockReturnValue(['PAN-12', 'MIN-12']);
      conversationMocks.getConversationById.mockReturnValue(null);
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('12');

      expect(result).toEqual({
        kind: 'ambiguous',
        input: '12',
        candidates: [
          { explicitForm: 'PAN-12', label: 'issue PAN-12' },
          { explicitForm: 'MIN-12', label: 'issue MIN-12' },
        ],
      });
    });

    it('is unresolved with no issue candidate and no conversation', async () => {
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('404');

      expect(result).toEqual({
        kind: 'unresolved',
        input: '404',
        reason: 'no issue agent or conversation matches 404',
      });
    });

    it('treats a vault-only conversation as no conversation', async () => {
      issueIdMocks.listBareNumericIssueMatches.mockReturnValue(['PAN-9999']);
      conversationMocks.getConversationById.mockReturnValue(VAULT_ROW);
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('9999');

      expect(result).toEqual({ kind: 'issue', issueId: 'PAN-9999' });
    });
  });

  describe('resolveCliAgentTarget — conversation lookup failures', () => {
    it('falls back to issue-only behavior for a bare number when the lookup throws', async () => {
      issueIdMocks.listBareNumericIssueMatches.mockReturnValue(['PAN-2972']);
      conversationMocks.getConversationById.mockImplementation(() => {
        throw new Error('db is locked');
      });
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('2972');

      expect(result).toEqual({ kind: 'issue', issueId: 'PAN-2972' });
    });

    it('is unresolved with the thrown message for an explicit form when the lookup throws', async () => {
      conversationMocks.getConversationById.mockImplementation(() => {
        throw new Error('db is locked');
      });
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('conv/2972');

      expect(result).toEqual({
        kind: 'unresolved',
        input: 'conv/2972',
        reason: 'conversation lookup failed: db is locked',
      });
    });
  });

  describe('resolveCliAgentTarget — issue IDs', () => {
    it('resolves a non-digit input to an issue', async () => {
      const { resolveCliAgentTarget } = await import('../agent-target.js');

      const result = await resolveCliAgentTarget('PAN-1148');

      expect(result).toEqual({ kind: 'issue', issueId: 'PAN-1148' });
    });
  });

  describe('printAgentTargetFailure', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('writes every accepted-form line and both explicit forms for an ambiguous result', async () => {
      const { printAgentTargetFailure, ACCEPTED_TARGET_FORMS } = await import('../agent-target.js');

      printAgentTargetFailure(
        {
          kind: 'ambiguous',
          input: '2972',
          candidates: [
            { explicitForm: 'PAN-2972', label: 'issue PAN-2972' },
            { explicitForm: 'conv/2972', label: 'conversation 2972 "Fernkite deploy" (conv-20260928-7563)' },
          ],
        },
        'tell',
      );

      const printed = errorSpy.mock.calls.map(([line]) => String(line)).join('\n');
      for (const line of ACCEPTED_TARGET_FORMS) {
        expect(printed).toContain(line);
      }
      expect(printed).toContain('PAN-2972');
      expect(printed).toContain('conv/2972');
    });
  });
});
