/**
 * FR-7: Conversation-only pending input surfaces.
 * Tests that NeedsYouStrip and ConversationDock:
 * 1. Materialize conversation-only entries with empty agent store (AC-1)
 * 2. Preserve agent-backed pending input entries (AC-3)
 * 3. Handle multiple conversations per docked issue (regression from cycle 13)
 *
 * AC-1 tests verify conversation-only rendering when no agents exist.
 * AC-3 test verifies agent-backed entries are preserved and routed with isConversation: false.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Set up all mocks BEFORE any imports to ensure hoisted vi.mock works
vi.mock('../lib/store', () => ({
  useDashboardStore: vi.fn(),
}));

vi.mock('../lib/useDecisions', () => ({
  usePendingInputSubjects: vi.fn(),
}));

vi.mock('../lib/simple/useSimpleActions', () => ({
  useSimpleActions: vi.fn(),
}));

// Mock convoDock with default empty dock; will be configured per test
vi.mock('../lib/convoDock', () => ({
  useConvoDock: vi.fn(() => ({
    items: [],
    expanded: true,
    remove: vi.fn(),
    setExpanded: vi.fn(),
  })),
}));

vi.mock('../lib/simple/derive', () => ({
  bucketSimpleHome: vi.fn(),
  deriveSimpleIssue: vi.fn(),
}));

// Mock DrawerAgentSession and related exports
vi.mock('../components/drawer/DrawerAgentSession', () => ({
  DrawerAgentSession: ({ agentId }: any) => (
    <div data-testid="drawer-agent-session">
      <div>{agentId}</div>
    </div>
  ),
  pickDefaultDrawerAgent: vi.fn((agents: any) => agents?.[0] ?? null),
}));

// Mock TalkItThrough to avoid unrelated requests
vi.mock('../components/simple/TalkItThrough', () => ({
  TalkItThrough: () => <div data-testid="talk-it-through" />,
}));

// Now import after all mocks are in place
import { NeedsYouStrip } from '../components/KanbanBoard/NeedsYouStrip';
import { ConversationDock } from '../components/dock/ConversationDock';
import { SimpleHomePage } from '../components/simple/SimpleHomePage';
import * as store from '../lib/store';
import * as decisions from '../lib/useDecisions';
import * as simpleActions from '../lib/simple/useSimpleActions';
import * as convoDock from '../lib/convoDock';
import * as derive from '../lib/simple/derive';

const mockIssue = {
  identifier: 'PAN-1',
  title: 'Test Issue',
  status: 'in-progress' as const,
  createdAt: new Date(Date.now() - 100000).toISOString(),
  updatedAt: new Date().toISOString(),
};

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
    vi.mocked(convoDock.useConvoDock).mockReturnValue({
      items: [],
      expanded: true,
      remove: vi.fn(),
      setExpanded: vi.fn(),
    });

    // Default: empty store, no pending subjects
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

    // Default: no agent-backed needs-you items, just an empty derivation
    const emptyDerivation = {
      issue: mockIssue,
      primaryAgent: undefined,
      pendingInputAgent: undefined,
      display: { sentence: '' },
      agentStuck: false,
      reviewStuck: false,
    };
    vi.mocked(derive.bucketSimpleHome).mockReturnValue({
      needsYou: [],
    } as any);
    vi.mocked(derive.deriveSimpleIssue).mockReturnValue(emptyDerivation as any);
  });

  describe('NeedsYouStrip: AC-1', () => {
    it('AC-1: renders conversation-only question without agent in store', () => {
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-001',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Ready to proceed?' }],
          },
        } as any,
      ]);

      render(<NeedsYouStrip onOpenIssue={vi.fn()} />);

      expect(screen.getByText('Ready to proceed?')).toBeInTheDocument();
      expect(screen.getByText('PAN-1')).toBeInTheDocument();
    });

    it('AC-1: handles multiple conversations on same issue', () => {
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-a',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'First conversation' }],
          },
        } as any,
        {
          agentId: 'conv-b',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Second conversation' }],
          },
        } as any,
      ]);

      render(<NeedsYouStrip onOpenIssue={vi.fn()} />);

      expect(screen.getByText('First conversation')).toBeInTheDocument();
      expect(screen.getByText('Second conversation')).toBeInTheDocument();
    });

    it('AC-1: routes conversation answer with isConversation true', () => {
      const answerMutate = vi.fn();
      vi.mocked(simpleActions.useSimpleActions).mockReturnValue({
        tell: { mutate: vi.fn(), isPending: false },
        recover: { mutate: vi.fn(), isPending: false },
        unstick: { mutate: vi.fn(), isPending: false },
        answer: { mutate: answerMutate, isPending: false },
      } as any);

      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-route-test',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Respond?' }],
          },
        } as any,
      ]);

      render(<NeedsYouStrip onOpenIssue={vi.fn()} />);

      const input = screen.getByPlaceholderText('Type your answer…');
      fireEvent.change(input, { target: { value: 'yes' } });
      fireEvent.click(screen.getByRole('button', { name: 'Answer' }));

      // Conversation ID routes with isConversation: true
      expect(answerMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'conv-route-test',
          text: 'yes',
          isConversation: true,
        })
      );
    });

    it('AC-3: preserves agent-backed pending input with isConversation false', () => {
      const answerMutate = vi.fn();
      vi.mocked(simpleActions.useSimpleActions).mockReturnValue({
        tell: { mutate: vi.fn(), isPending: false },
        recover: { mutate: vi.fn(), isPending: false },
        unstick: { mutate: vi.fn(), isPending: false },
        answer: { mutate: answerMutate, isPending: false },
      } as any);

      // Mock bucketSimpleHome to return agent-backed needs-you item
      const mockAgentDerivation = {
        issue: mockIssue,
        primaryAgent: mockAgent,
        pendingInputAgent: mockAgent,
        display: { sentence: 'Agent question' },
        agentStuck: false,
        reviewStuck: false,
      };

      vi.mocked(derive.bucketSimpleHome).mockReturnValue({
        needsYou: [
          {
            source: 'agent' as const,
            derivation: mockAgentDerivation,
            kind: 'question' as const,
            subjectId: 'agent-test-1',
          },
        ],
      } as any);

      vi.mocked(derive.deriveSimpleIssue).mockReturnValue(mockAgentDerivation as any);

      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'agent-test-1',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Agent needs input' }],
          },
        } as any,
      ]);

      vi.mocked(store.useDashboardStore).mockImplementation((selector) => {
        const state = {
          issuesRaw: [mockIssue],
          agentsById: { 'agent-test-1': mockAgent },
          reviewStatusByIssueId: {},
        };
        return selector(state as any);
      });

      render(<NeedsYouStrip onOpenIssue={vi.fn()} />);

      const input = screen.getByPlaceholderText('Type your answer…');
      fireEvent.change(input, { target: { value: 'agent response' } });
      fireEvent.click(screen.getByRole('button', { name: 'Answer' }));

      // Agent-backed entry routes with isConversation: false
      expect(answerMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-test-1',
          text: 'agent response',
          isConversation: false,
        })
      );
    });
  });

  describe('ConversationDock: AC-1', () => {
    it('AC-1: materializes conversation-only entry without agent', () => {
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-dock-001',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Dock conv' }],
          },
        } as any,
      ]);

      render(<ConversationDock />);

      expect(screen.getByText('conv-dock-001')).toBeInTheDocument();
      expect(screen.getByText(/PAN-1.*Test Issue/)).toBeInTheDocument();
    });

    it('AC-1 + Regression: materializes multiple conversations for same docked issue', () => {
      // Set up docked issue PAN-1
      vi.mocked(convoDock.useConvoDock).mockReturnValue({
        items: [{ issueId: 'PAN-1', addedAt: Date.now() }],
        expanded: true,
        remove: vi.fn(),
        setExpanded: vi.fn(),
      });

      // Two conversations for the docked issue (no agents in store)
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-docked-1',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'First' }],
          },
        } as any,
        {
          agentId: 'conv-docked-2',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Second' }],
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

      // Both conversations should appear, replacing the empty issue panel
      expect(screen.getByText('conv-docked-1')).toBeInTheDocument();
      expect(screen.getByText('conv-docked-2')).toBeInTheDocument();

      // Issue panel should not render twice (no empty issue entry)
      const issueTitles = screen.queryAllByText(/PAN-1.*Test Issue/);
      expect(issueTitles.length).toBe(2); // One per conversation panel
    });
  });

  describe('SimpleHomePage: AC-1', () => {
    it('AC-1: renders conversation-only pending subject via extraQuestions in SimpleHomePage', () => {
      // Set up SimpleHomePage with a conversation-only pending subject via the extraQuestions path
      const convSimpleDerivation = {
        issue: mockIssue,
        primaryAgent: undefined,
        pendingInputAgent: undefined,
        display: { sentence: '' },
        agentStuck: false,
        reviewStuck: false,
      };

      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'conv-simple-001',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'SimpleHomePage conversation question' }],
          },
        } as any,
      ]);

      // Complete bucket structure with all required arrays
      // Conversation subjects route via extraQuestions, not needsYou
      vi.mocked(derive.bucketSimpleHome).mockReturnValue({
        needsYou: [],
        working: [],
        ready: [],
        finished: [],
      } as any);

      vi.mocked(derive.deriveSimpleIssue).mockReturnValue(convSimpleDerivation as any);

      // Wrap with QueryClientProvider because SimpleHomePage calls useQuery
      const queryClient = new QueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <SimpleHomePage />
        </QueryClientProvider>
      );

      // Verify conversation question appears as actionable card in SimpleHomePage
      expect(screen.getByText('SimpleHomePage conversation question')).toBeInTheDocument();
      // Issue ID is part of a larger text node (e.g., "Question · PAN-1")
      expect(screen.getByText(/PAN-1/)).toBeInTheDocument();
    });
  });

  describe('ConversationDock: AC-3', () => {
    it('AC-3: preserves agent-backed dock panel when agent exists for docked issue', () => {
      // Set up docked issue with agent pending input
      vi.mocked(convoDock.useConvoDock).mockReturnValue({
        items: [{ issueId: 'PAN-1', addedAt: Date.now() }],
        expanded: true,
        remove: vi.fn(),
        setExpanded: vi.fn(),
      });

      // Agent snapshot for the docked issue — this is what AC-3 tests: agent preservation
      const mockAgentDerivation = {
        issue: mockIssue,
        primaryAgent: mockAgent,
        pendingInputAgent: mockAgent,
        display: { sentence: 'Agent waiting' },
        agentStuck: false,
        reviewStuck: false,
      };

      // Only agent-backed pending subject (no coexistence test)
      vi.mocked(decisions.usePendingInputSubjects).mockReturnValue([
        {
          agentId: 'agent-test-1',
          issueId: 'PAN-1',
          since: new Date().toISOString(),
          pendingAskUserQuestion: {
            questions: [{ question: 'Agent input needed' }],
          },
        } as any,
      ]);

      vi.mocked(store.useDashboardStore).mockImplementation((selector) => {
        const state = {
          issuesRaw: [mockIssue],
          agentsById: { 'agent-test-1': mockAgent },
          reviewStatusByIssueId: {},
        };
        return selector(state as any);
      });

      vi.mocked(derive.deriveSimpleIssue).mockReturnValue(mockAgentDerivation as any);

      // Wrap with QueryClientProvider using ESM import to match DrawerAgentSession's React Query context
      const queryClient = new QueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <ConversationDock />
        </QueryClientProvider>
      );

      // Verify agent panel is rendered for the docked issue
      expect(screen.getByText(/PAN-1.*Test Issue/)).toBeInTheDocument();
      // DrawerAgentSession mock renders agent identity; verify it appears
      expect(screen.getByTestId('drawer-agent-session')).toBeInTheDocument();
      expect(screen.getByText('agent-test-1')).toBeInTheDocument();
    });
  });
});
