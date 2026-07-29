/**
 * FR-7: Conversation-only pending input surfaces.
 * Tests that NeedsYouStrip, SimpleHomePage, and ConversationDock materialize
 * conversation-only entries with empty agent store and preserve agent entries.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NeedsYouStrip } from '../components/KanbanBoard/NeedsYouStrip';
import { SimpleHomePage } from '../components/simple/SimpleHomePage';
import { ConversationDock } from '../components/dock/ConversationDock';
import * as store from '../lib/store';
import * as decisions from '../lib/useDecisions';
import * as simpleActions from '../lib/simple/useSimpleActions';

// Mock store
vi.mock('../lib/store', () => ({
  useDashboardStore: vi.fn(),
}));

// Mock decisions hook
vi.mock('../lib/useDecisions', () => ({
  usePendingInputSubjects: vi.fn(),
}));

// Mock useSimpleActions
vi.mock('../lib/simple/useSimpleActions', () => ({
  useSimpleActions: vi.fn(),
}));

const mockIssue = {
  identifier: 'PAN-1',
  title: 'Test Issue',
  status: 'in-progress' as const,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockAgent = {
  id: 'agent-test-1',
  issueId: 'PAN-1',
  status: 'running' as const,
  name: 'test-agent',
  pendingInputAgent: {
    id: 'agent-test-1',
    issueId: 'PAN-1',
  },
};

describe('FR-7: Conversation-only pending input surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: empty store
    vi.mocked(store.useDashboardStore).mockImplementation((selector) => {
      const state = {
        issuesRaw: [mockIssue],
        agentsById: {},
        reviewStatusByIssueId: {},
      };
      return selector(state as any);
    });

    vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([]);
    vi.mocked(simpleActions.useSimpleActions).mockReturnValue({
      tell: { mutate: vi.fn(), isPending: false },
      recover: { mutate: vi.fn(), isPending: false },
      unstick: { mutate: vi.fn(), isPending: false },
      answer: { mutate: vi.fn(), isPending: false },
    } as any);
  });

  describe('NeedsYouStrip: conversation-only rendering', () => {
    it('renders conversation-only pending input with empty agent store', () => {
      const conversationName = 'conv-test-123';
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: conversationName,
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Do you want to proceed?' }],
          },
        } as any,
      ]);

      const onOpen = vi.fn();
      render(<NeedsYouStrip onOpenIssue={onOpen} />);

      expect(screen.getByText('Do you want to proceed?')).toBeInTheDocument();
      expect(screen.getByText('PAN-1')).toBeInTheDocument();
    });

    it('preserves agent-sourced question text with non-empty agent store', () => {
      vi.mocked(store.useDashboardStore).mockImplementation((selector) => {
        const state = {
          issuesRaw: [mockIssue],
          agentsById: { 'agent-test-1': mockAgent },
          reviewStatusByIssueId: {},
        };
        return selector(state as any);
      });

      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'agent-test-1',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Agent question: proceed?' }],
          },
        } as any,
      ]);

      const onOpen = vi.fn();
      render(<NeedsYouStrip onOpenIssue={onOpen} />);

      expect(screen.getByText('Agent question: proceed?')).toBeInTheDocument();
    });

    it('handles multiple conversations on same issue with distinct identities', () => {
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-a',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Conversation A question' }],
          },
        } as any,
        {
          agentId: 'conv-b',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Conversation B question' }],
          },
        } as any,
      ]);

      const onOpen = vi.fn();
      render(<NeedsYouStrip onOpenIssue={onOpen} />);

      expect(screen.getByText('Conversation A question')).toBeInTheDocument();
      expect(screen.getByText('Conversation B question')).toBeInTheDocument();
    });

    it('routes conversation answer to message endpoint', async () => {
      const conversationName = 'conv-test-456';
      const answerMutate = vi.fn();
      vi.mocked(simpleActions.useSimpleActions).mockReturnValue({
        tell: { mutate: vi.fn(), isPending: false },
        recover: { mutate: vi.fn(), isPending: false },
        unstick: { mutate: vi.fn(), isPending: false },
        answer: { mutate: answerMutate, isPending: false },
      } as any);

      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: conversationName,
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Your answer?' }],
          },
        } as any,
      ]);

      const onOpen = vi.fn();
      render(<NeedsYouStrip onOpenIssue={onOpen} />);

      const input = screen.getByPlaceholderText('Type your answer…');
      fireEvent.change(input, { target: { value: 'yes' } });

      const answerButton = screen.getByRole('button', { name: 'Answer' });
      fireEvent.click(answerButton);

      expect(answerMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: conversationName,
          text: 'yes',
          isConversation: true,
        })
      );
    });
  });

  describe('SimpleHomePage: conversation-only rendering', () => {
    it('renders conversation-only card with empty agent store', () => {
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-home-test',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'SimpleHome question?' }],
          },
        } as any,
      ]);

      render(<SimpleHomePage />);
      expect(screen.getByText('SimpleHome question?')).toBeInTheDocument();
    });
  });

  describe('ConversationDock: conversation-only rendering', () => {
    it('materializes conversation-only entry in empty dock', () => {
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-dock-test',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Dock question?' }],
          },
        } as any,
      ]);

      vi.mocked(store.useDashboardStore).mockImplementation((selector) => {
        const state = {
          issuesRaw: [mockIssue],
          agentsById: {},
          reviewStatusByIssueId: {},
        };
        return selector(state as any);
      });

      // Mock useConvoDock
      vi.doMock('../lib/convoDock', () => ({
        useConvoDock: () => ({
          items: [],
          expanded: true,
          remove: vi.fn(),
          setExpanded: vi.fn(),
        }),
      }));

      const { container } = render(<ConversationDock />);

      // Verify "1 needs you" badge appears
      expect(screen.getByText('1 needs you')).toBeInTheDocument();

      // Verify conversation panel is rendered with conversation name
      expect(screen.getByText('conv-dock-test')).toBeInTheDocument();
    });

    it('shows issue title in conversation panel', () => {
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-title-test',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Q?' }],
          },
        } as any,
      ]);

      vi.mocked(store.useDashboardStore).mockImplementation((selector) => {
        const state = {
          issuesRaw: [mockIssue],
          agentsById: {},
          reviewStatusByIssueId: {},
        };
        return selector(state as any);
      });

      vi.doMock('../lib/convoDock', () => ({
        useConvoDock: () => ({
          items: [],
          expanded: true,
          remove: vi.fn(),
          setExpanded: vi.fn(),
        }),
      }));

      render(<ConversationDock />);

      expect(screen.getByText(/PAN-1.*Test Issue/)).toBeInTheDocument();
    });
  });
});
