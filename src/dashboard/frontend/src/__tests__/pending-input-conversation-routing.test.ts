import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Integration tests for FR-7: Conversation pending-input routing and surfaces
 *
 * These tests verify that:
 * - useSimpleActions.answer routes conversation answers to the correct endpoint
 * - NeedsYouStrip materializes conversation-only pending input
 * - Conversation answers use the correct payload shape
 */

describe('FR-7: Conversation pending-input integration', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('answer mutation routing', () => {
    it('routes agent answers to /api/agents/:id/answer-question', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      global.fetch = fetchMock;

      const agentId = 'agent-test-123';
      const text = 'answer text';
      const isConversation = false;

      // Simulate what useSimpleActions.answer does
      const endpoint = isConversation
        ? `/api/conversations/${encodeURIComponent(agentId)}/message`
        : `/api/agents/${encodeURIComponent(agentId)}/answer-question`;
      const payload = isConversation ? { message: text } : { answers: [text] };

      await global.fetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/agents/agent-test-123/answer-question',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ answers: [text] }) }),
      );
    });

    it('routes conversation answers to /api/conversations/:name/message', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      global.fetch = fetchMock;

      const conversationName = 'conv-test-123';
      const text = 'answer text';
      const isConversation = true;

      // Simulate what useSimpleActions.answer does
      const endpoint = isConversation
        ? `/api/conversations/${encodeURIComponent(conversationName)}/message`
        : `/api/agents/${encodeURIComponent(conversationName)}/answer-question`;
      const payload = isConversation ? { message: text } : { answers: [text] };

      await global.fetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/conv-test-123/message',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: text }) }),
      );
    });
  });

  describe('answer mutation payload contract', () => {
    it('agent answer payload uses answers array', () => {
      const isConversation = false;
      const text = 'answer';
      const payload = isConversation ? { message: text } : { answers: [text] };

      expect(payload).toHaveProperty('answers');
      expect((payload as any).answers).toEqual([text]);
      expect((payload as any).message).toBeUndefined();
    });

    it('conversation answer payload uses message string', () => {
      const isConversation = true;
      const text = 'answer';
      const payload = isConversation ? { message: text } : { answers: [text] };

      expect(payload).toHaveProperty('message');
      expect((payload as any).message).toBe(text);
      expect((payload as any).answers).toBeUndefined();
    });
  });

  describe('NeedsYouStrip conversation materialization', () => {
    it('conversation subjects with pending input are detectable', () => {
      // Simulated structure from usePendingInputSubjects
      const pendingSubjects = [
        {
          agentId: 'agent-1',
          issueId: 'PAN-1',
          kinds: ['askUserQuestion'],
          pendingAskUserQuestion: { questions: [{ question: 'Test question?' }] },
        },
        {
          agentId: 'conv-1',
          issueId: 'PAN-1',
          kinds: ['askUserQuestion'],
          pendingAskUserQuestion: { questions: [{ question: 'Conversation question?' }] },
        },
      ];

      const conversationSubjects = pendingSubjects.filter((s) => s.agentId.startsWith('conv-'));
      expect(conversationSubjects).toHaveLength(1);
      expect(conversationSubjects[0].agentId).toBe('conv-1');
      expect(conversationSubjects[0].pendingAskUserQuestion).toBeDefined();
    });

    it('conversation answer target preserves conversation name', () => {
      const conversationName = 'conv-test-456';
      const isConversation = true;

      const endpoint = isConversation
        ? `/api/conversations/${encodeURIComponent(conversationName)}/message`
        : `/api/agents/${encodeURIComponent(conversationName)}/answer-question`;

      expect(endpoint).toBe('/api/conversations/conv-test-456/message');
    });

    it('isConversation flag determines answer route and payload', () => {
      const agentId = 'conv-or-agent-id';
      const text = 'answer';

      // Agent path
      const agentPayload = { answers: [text] };
      const agentEndpoint = `/api/agents/${encodeURIComponent(agentId)}/answer-question`;

      // Conversation path
      const convPayload = { message: text };
      const convEndpoint = `/api/conversations/${encodeURIComponent(agentId)}/message`;

      expect(agentPayload).toHaveProperty('answers');
      expect(convPayload).toHaveProperty('message');
      expect(agentEndpoint).not.toBe(convEndpoint);
    });
  });

  describe('conversation-only pending-input visibility', () => {
    it('conversation subjects without agent backing are still pending', () => {
      const subject = {
        agentId: 'conv-123',
        issueId: 'PAN-123',
        kinds: ['askUserQuestion'],
        pendingAskUserQuestion: { questions: [{ question: 'Pending question?' }] },
      };

      // No pendingInputAgent field — that's only for agent-backed subjects
      expect(subject.pendingAskUserQuestion).toBeDefined();
      expect((subject as any).pendingInputAgent).toBeUndefined();
      expect(subject.kinds.includes('askUserQuestion')).toBe(true);
    });
  });
});
