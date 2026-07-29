/**
 * FR-7: Conversation-only pending input surfaces.
 * Tests that NeedsYouStrip and ConversationDock:
 * 1. Materialize conversation-only entries with empty agent store (AC-1)
 * 2. Preserve agent-backed pending input entries (AC-3)
 * 3. Distinguish conversation and agent sources correctly
 * 4. Handle multiple conversations per docked issue (Cycle 13 regression)
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

// Now import after all mocks are in place
import { NeedsYouStrip } from '../components/KanbanBoard/NeedsYouStrip';
import { ConversationDock } from '../components/dock/ConversationDock';
import * as store from '../lib/store';
import * as decisions from '../lib/useDecisions';
import * as simpleActions from '../lib/simple/useSimpleActions';
import * as convoDock from '../lib/convoDock';

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
  });

  describe('NeedsYouStrip: conversation and agent sources', () => {
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

    it('handles multiple conversations on same issue', () => {
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

    it('routes conversation answer with isConversation flag', () => {
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

      expect(answerMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'conv-route-test',
          text: 'yes',
          isConversation: true,
        })
      );
    });
  });

  describe('ConversationDock: conversation rendering and docked replacement', () => {
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

    it('Regression: materializes multiple conversations for same docked issue', () => {
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
});
