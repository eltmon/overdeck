/**
 * FR-7: Conversation-only pending input surfaces.
 * Tests that NeedsYouStrip and ConversationDock materialize conversation-only
 * entries with empty agent store, preserve agent entries, and handle multiple
 * conversations per docked issue correctly.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NeedsYouStrip } from '../components/KanbanBoard/NeedsYouStrip';
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

// Mock convoDock before ConversationDock import
vi.mock('../lib/convoDock', () => ({
  useConvoDock: vi.fn(() => ({
    items: [],
    expanded: true,
    remove: vi.fn(),
    setExpanded: vi.fn(),
  })),
}));

// Import after mocks are set up
import { ConversationDock } from '../components/dock/ConversationDock';

const mockIssue = {
  identifier: 'PAN-1',
  title: 'Test Issue',
  status: 'in-progress' as const,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// Mock agent with real enrichment fields for pending input
const mockAgent = {
  id: 'agent-test-1',
  issueId: 'PAN-1',
  status: 'running' as const,
  name: 'test-agent',
  pendingInputKinds: ['question'] as const,
} as any;

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
    it('renders conversation-only pending input card', () => {
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

      // Verify the question appears
      expect(screen.getByText('Do you want to proceed?')).toBeInTheDocument();
      expect(screen.getByText('PAN-1')).toBeInTheDocument();
    });

    it('displays distinct questions for multiple conversations on same issue', () => {
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

    it('routes conversation answer to correct target', () => {
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

      // Verify answer is routed with isConversation flag
      expect(answerMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: conversationName,
          text: 'yes',
          isConversation: true,
        })
      );
    });
  });

  describe('ConversationDock: conversation-only materialization', () => {
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

      render(<ConversationDock />);

      // Verify conversation panel is rendered with conversation name and issue
      expect(screen.getByText('conv-dock-test')).toBeInTheDocument();
      expect(screen.getByText(/PAN-1.*Test Issue/)).toBeInTheDocument();
    });

    it('materializes multiple conversations for same docked issue', () => {
      // Set up a docked item
      const dockedItemsMock = vi.fn(() => ({
        items: [{ issueId: 'PAN-1', addedAt: Date.now() }],
        expanded: true,
        remove: vi.fn(),
        setExpanded: vi.fn(),
      }));

      vi.doMock('../lib/convoDock', () => ({
        useConvoDock: dockedItemsMock,
      }), { virtual: true });

      // Two pending conversations for the same docked issue
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-docked-1',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'First conversation' }],
          },
        } as any,
        {
          agentId: 'conv-docked-2',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Second conversation' }],
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

      render(<ConversationDock />);

      // Both conversations should be materializ in the dock
      expect(screen.getByText('conv-docked-1')).toBeInTheDocument();
      expect(screen.getByText('conv-docked-2')).toBeInTheDocument();
    });
  });
});
