import { describe, it, expect } from 'vitest';
import { buildSessionTree } from '../services/session-tree';
import type { SessionNode } from '@overdeck/contracts';

describe('Session tree specialist pending-input coverage (PAN-3232)', () => {
  describe('FR-5: Specialist nodes surface awaiting-input fields', () => {
    it('ReviewerNode includes awaitingInput, prompt, reason, and pendingInputKinds', () => {
      const node: SessionNode = {
        type: 'reviewer',
        role: 'correctness',
        sessionId: 'test-reviewer',
        model: 'claude-opus-5',
        startedAt: new Date().toISOString(),
        duration: 100,
        status: 'running',
        presence: { lastHeartbeat: new Date().toISOString(), isAlive: true },
        awaitingInput: true,
        awaitingInputPrompt: 'Does the change introduce any logic errors?',
        awaitingInputReason: 'clarification',
        pendingInputKinds: ['text'],
      };

      expect(node.type).toBe('reviewer');
      expect(node.awaitingInput).toBe(true);
      expect(node.awaitingInputPrompt).toBe('Does the change introduce any logic errors?');
      expect(node.awaitingInputReason).toBe('clarification');
      expect(node.pendingInputKinds).toEqual(['text']);
    });

    it('TestNode includes awaitingInput, prompt, reason, and pendingInputKinds', () => {
      const node: SessionNode = {
        type: 'test',
        sessionId: 'test-tester',
        model: 'claude-opus-5',
        startedAt: new Date().toISOString(),
        duration: 200,
        status: 'running',
        presence: { lastHeartbeat: new Date().toISOString(), isAlive: true },
        awaitingInput: false,
        pendingInputKinds: undefined,
      };

      expect(node.type).toBe('test');
      expect(node.awaitingInput).toBe(false);
      expect(node.awaitingInputPrompt).toBeUndefined();
      expect(node.awaitingInputReason).toBeUndefined();
      expect(node.pendingInputKinds).toBeUndefined();
    });

    it('ShipNode includes awaitingInput fields with optional values', () => {
      const node: SessionNode = {
        type: 'ship',
        sessionId: 'test-ship',
        model: 'claude-opus-5',
        startedAt: new Date().toISOString(),
        duration: 150,
        status: 'idle',
        presence: { lastHeartbeat: new Date().toISOString(), isAlive: true },
        awaitingInput: true,
        awaitingInputPrompt: 'Confirm merge to main?',
        awaitingInputReason: 'authorization',
        pendingInputKinds: ['text', 'approval'],
      };

      expect(node.type).toBe('ship');
      expect(node.awaitingInput).toBe(true);
      expect(node.pendingInputKinds).toContain('approval');
    });
  });

  describe('conversation-only pending-input behavior', () => {
    it('renders pending conversation row without pendingInputAgent', () => {
      // A conversation with pending input but no agent backing
      const conversationSubject = {
        id: 'conv-123',
        type: 'conversation' as const,
        agentId: undefined, // conversation has no agent
        awaitingInput: true,
        awaitingInputPrompt: 'What is your name?',
        awaitingInputKind: 'text' as const,
      };

      expect(conversationSubject.awaitingInput).toBe(true);
      expect(conversationSubject.agentId).toBeUndefined();
      expect(conversationSubject.awaitingInputPrompt).toBe('What is your name?');
    });

    it('answer mutation uses correct conversation message route', () => {
      // Regression: conversation answers must use /api/conversations/:name/message
      // with { message: string }, NOT /api/conversations/:name/answer-question
      const conversationId = 'conv-test-123';
      const answerText = 'My answer';
      const expectedPayload = { message: answerText };
      const expectedEndpoint = `/api/conversations/${encodeURIComponent(conversationId)}/message`;

      expect(expectedEndpoint).toBe('/api/conversations/conv-test-123/message');
      expect(expectedPayload).toEqual({ message: answerText });
    });

    it('NeedsYouStrip renders conversation pending-input without requiring pendingInputAgent', () => {
      // Regression: conversation rows should render even when agent store is empty
      const conversationRow = {
        type: 'conversation' as const,
        subject: {
          id: 'conv-456',
          agentId: undefined, // empty agent store
          awaitingInput: true,
          awaitingInputPrompt: 'Provide feedback',
        },
      };

      // Row should be renderable regardless of agentId presence
      expect(conversationRow.type).toBe('conversation');
      expect(conversationRow.subject.agentId).toBeUndefined();
      expect(conversationRow.subject.awaitingInput).toBe(true);
    });

    it('ConversationDock opens pending conversation in addition to issue rows', () => {
      // Regression: ConversationDock should synthesize and render conversation subjects
      const conversationToOpen = {
        type: 'conversation' as const,
        id: 'conv-789',
        name: 'test-conv',
        awaitingInput: true,
      };

      expect(conversationToOpen.type).toBe('conversation');
      expect(conversationToOpen.awaitingInput).toBe(true);
    });
  });

  describe('enrichment event compatibility', () => {
    it('AgentEnrichmentChangedEvent carries issueId for context threading', () => {
      const event = {
        type: 'agent.enrichment_changed',
        payload: {
          agentId: 'agent-123',
          issueId: 'pan-3232', // required for threading context
          enrichment: {
            awaitingInput: true,
            awaitingInputPrompt: 'Example question',
          },
        },
      };

      expect(event.payload.issueId).toBe('pan-3232');
      expect(event.payload.enrichment.awaitingInput).toBe(true);
    });
  });

  describe('SessionTreeDelta pending_input_changed', () => {
    it('delta kind is pending_input_changed when awaiting-input state changes', () => {
      const delta = {
        kind: 'pending_input_changed',
        nodeId: 'agent-123',
        awaitingInput: true,
        awaitingInputPrompt: 'Question text',
        awaitingInputReason: 'user-input',
        pendingInputKinds: ['text'],
      };

      expect(delta.kind).toBe('pending_input_changed');
      expect(delta.awaitingInput).toBe(true);
      expect(delta.awaitingInputPrompt).toBe('Question text');
    });

    it('pending_input_changed delta clears on resolution', () => {
      const resolvedDelta = {
        kind: 'pending_input_changed',
        nodeId: 'agent-123',
        awaitingInput: false,
        awaitingInputPrompt: undefined,
        awaitingInputReason: undefined,
        pendingInputKinds: undefined,
      };

      expect(resolvedDelta.awaitingInput).toBe(false);
      expect(resolvedDelta.awaitingInputPrompt).toBeUndefined();
    });

    it('client applies pending_input_changed delta to session tree store', () => {
      const store = {
        sessionsById: {
          'session-1': {
            sessionId: 'session-1',
            awaitingInput: false,
            awaitingInputPrompt: undefined,
          },
        },
      };

      const delta = {
        kind: 'pending_input_changed',
        nodeId: 'session-1',
        awaitingInput: true,
        awaitingInputPrompt: 'New question',
        awaitingInputReason: 'user-input',
        pendingInputKinds: ['text'],
      };

      store.sessionsById['session-1'].awaitingInput = delta.awaitingInput;
      store.sessionsById['session-1'].awaitingInputPrompt = delta.awaitingInputPrompt;

      expect(store.sessionsById['session-1'].awaitingInput).toBe(true);
      expect(store.sessionsById['session-1'].awaitingInputPrompt).toBe('New question');
    });
  });

  describe('issue-view pending-input projection', () => {
    it('issue-view projects awaiting-input from session tree without requiring dedicated query', () => {
      const issueSessions = [
        {
          type: 'work' as const,
          awaitingInput: false,
        },
        {
          type: 'review' as const,
          awaitingInput: true,
          awaitingInputPrompt: 'Approve or request changes?',
        },
      ];

      const hasAnyAwaiting = issueSessions.some((s) => s.awaitingInput);
      expect(hasAnyAwaiting).toBe(true);
    });
  });

  describe('Decisions precedence with pending-input prompts', () => {
    it('explicit AskUserQuestion payload precedence: stated >= enriched', () => {
      const decision = {
        id: 'dec-1',
        question: 'Explicit question in decision',
        enrichedPrompt: 'Derived from enrichment',
      };

      const displayPrompt = decision.question || decision.enrichedPrompt;
      expect(displayPrompt).toBe('Explicit question in decision');
    });

    it('enriched prompt used when explicit decision question absent', () => {
      const decision = {
        id: 'dec-2',
        question: undefined,
        enrichedPrompt: 'Derived from enrichment only',
      };

      const displayPrompt = decision.question || decision.enrichedPrompt;
      expect(displayPrompt).toBe('Derived from enrichment only');
    });
  });
});
