import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { DecisionsPanel, DecisionsCount } from '../DecisionsPanel';
import * as useDecisionsModule from '../../lib/useDecisions';
import { useAskUserQuestionUiStore } from '../../lib/askUserQuestionUiStore';
import { useDashboardStore } from '../../lib/store';
import { isAwaitingInput } from '../../lib/pendingInput';

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const agentDecision = {
  id: 'planning-pan-2760',
  source: 'agent' as const,
  label: 'PAN-2760 — Add issue titles',
  issueId: 'PAN-2760',
  issueTitle: 'Add issue titles',
  kinds: ['askUserQuestion'],
  pendingAskUserQuestion: {
    toolUseId: 'toolu_1',
    askedAt: '2026-07-16T01:57:24.055Z',
    questions: [{ question: 'Which approach for crew create?', header: 'Approach', options: [{ label: 'A' }] }],
  },
  since: '2026-07-16T01:57:24.055Z',
  blocking: true,
};

const conversationDecision = {
  id: 'conv-20260716-6155',
  source: 'conversation' as const,
  label: 'Docs domain move',
  issueId: 'PAN-3097',
  issueTitle: 'Add question context',
  kinds: ['askUserQuestion'],
  pendingAskUserQuestion: {
    toolUseId: 'toolu_2',
    askedAt: '2026-07-16T02:00:00.000Z',
    questions: [{ question: 'Mint a Cloudflare token?', header: 'CF access', options: [{ label: 'Yes' }] }],
  },
  since: '2026-07-16T02:00:00.000Z',
  blocking: true,
};

const planDecision = {
  id: 'agent-pan-2748',
  source: 'agent' as const,
  label: 'PAN-2748',
  kinds: ['exitPlanMode'],
  since: '2026-07-16T02:10:00.000Z',
  blocking: false,
};

describe('DecisionsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAskUserQuestionUiStore.setState({ reopenId: null, reopenNonce: 0 });
  });

  /**
   * The defect this surface exists for: conversations arrive from a different
   * door than agents, and the old "Needs you" selector read only agentsById — so
   * a question from a conversation or the flywheel was invisible.
   */
  it('lists conversations alongside agents', () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([agentDecision, conversationDecision]);
    renderWithQuery(<DecisionsPanel />);

    expect(screen.getByText('PAN-2760 — Add issue titles')).toBeTruthy();
    expect(screen.getByText('Docs domain move')).toBeTruthy();
    expect(screen.getByText('PAN-3097 — Add question context')).toBeTruthy();
    expect(screen.getByText('Conversation')).toBeTruthy();
  });

  it('groups by consequence, not by kind', () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([agentDecision, planDecision]);
    renderWithQuery(<DecisionsPanel />);

    expect(screen.getByText('Blocking work')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
  });

  it('marks a stopped agent as blocking and a plan review as not', () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([agentDecision, planDecision]);
    const { container } = renderWithQuery(<DecisionsPanel />);

    expect(container.querySelector('[data-decision-id="planning-pan-2760"][data-blocking="true"]')).not.toBeNull();
    expect(container.querySelector('[data-decision-id="agent-pan-2748"][data-blocking="true"]')).toBeNull();
  });

  it('shows SLA and dangerous chips for a Deft escalation only (PAN-4849)', () => {
    const deftDecision = {
      ...agentDecision,
      id: 'agent-pan-1',
      label: 'PAN-1',
      pendingAskUserQuestion: {
        toolUseId: 'deft-escalation:esc-20261102120000-aaaaaa',
        askedAt: '2026-11-02T12:00:00Z',
        questions: [{
          question: 'Run the database migration',
          header: 'cmd_approval',
          context: 'npm run migrate drops the old table.\n\nSLA 1h (due 2026-11-02T13:00:00.000Z)\nDANGEROUS',
          options: [{ label: 'Approve' }],
        }],
      },
    };
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([deftDecision, conversationDecision]);
    const { container } = renderWithQuery(<DecisionsPanel />);
    const deftRow = container.querySelector('[data-decision-id="agent-pan-1"]') as HTMLElement;
    expect(deftRow.textContent).toContain('SLA 1h');
    expect(deftRow.textContent).toContain('dangerous');
    const otherRow = container.querySelector('[data-decision-id="conv-20260716-6155"]') as HTMLElement;
    expect(otherRow.textContent).not.toContain('SLA');
    expect(otherRow.textContent).not.toContain('dangerous');
  });

  it('shows an external-only Deft escalation as a quiet note, not a decision or a waiting agent (PAN-4849 review)', () => {
    const agent = { id: 'agent-pan-1', issueId: 'PAN-1', status: 'running', pendingInputCount: 0, pendingInputKinds: [], deftExternalEscalations: 1 };
    const previous = useDashboardStore.getState().agentsById;
    useDashboardStore.setState({ agentsById: { 'agent-pan-1': agent } } as unknown as Parameters<typeof useDashboardStore.setState>[0]);
    try {
      vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([]);
      renderWithQuery(<DecisionsPanel />);
      expect(screen.getByTestId('decisions-empty')).toBeTruthy();
      expect(screen.getByTestId('deft-external-notes').textContent).toBe('PAN-1 · Deft: waiting on external (1)');
      const { container } = renderWithQuery(<DecisionsCount />);
      expect(container.innerHTML).toBe('');
      expect(isAwaitingInput(agent)).toBe(false);
    } finally {
      useDashboardStore.setState({ agentsById: previous } as Parameters<typeof useDashboardStore.setState>[0]);
    }
  });

  it('shows the actual question text, not just the kind', () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([agentDecision]);
    renderWithQuery(<DecisionsPanel />);
    expect(screen.getByText('Which approach for crew create?')).toBeTruthy();
  });

  it('PAN-4946: renders mcp-sign-in-card for an mcpSignIn decision, with no Answer button', () => {
    const mcpSignInDecision = {
      id: 'appr-1',
      source: 'agent' as const,
      label: 'Claude Desktop',
      kinds: ['mcpSignIn'],
      since: '2026-11-04T00:00:00.000Z',
      blocking: true,
      mcpSignIn: {
        id: 'appr-1',
        clientId: 'odc_123',
        clientName: 'Claude Desktop',
        redirectHost: 'claude.ai',
        requestedLevel: 'admin',
        approvalCode: 'KQZT-MWRB',
        createdAt: '2026-11-04T00:00:00.000Z',
        expiresAt: '2026-11-04T00:10:00.000Z',
      },
    };
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([mcpSignInDecision]);
    renderWithQuery(<DecisionsPanel />);

    expect(screen.getByTestId('mcp-sign-in-card')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    // An unrecognized requestedLevel ('admin') defaults the select to 'Read only'.
    expect(screen.getByRole('combobox', { name: 'Access level' })).toHaveValue('read');
  });

  it('Answer re-opens the dialog for that subject', async () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([conversationDecision]);
    renderWithQuery(<DecisionsPanel />);

    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));

    expect(useAskUserQuestionUiStore.getState().reopenId).toBe('conv-20260716-6155');
  });

  it('says nothing needs you when the list is empty', () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([]);
    renderWithQuery(<DecisionsPanel />);
    expect(screen.getByTestId('decisions-empty')).toBeTruthy();
  });

  describe('held handoff (PAN-4596)', () => {
    const heldDecision = {
      id: 'conv-held',
      source: 'conversation' as const,
      label: 'Bundle',
      kinds: ['heldKickoff'],
      since: '2026-10-04T13:19:27.000Z',
      blocking: false,
      heldKickoffFocus: 'Read the brief',
    };

    beforeEach(() => {
      window.history.replaceState(null, '', '/');
    });

    it('lists a held conversation under Waiting with its label and focus, and no Answer button', () => {
      vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([heldDecision]);
      const { container } = renderWithQuery(<DecisionsPanel />);

      expect(screen.getByText('Waiting')).toBeTruthy();
      expect(screen.queryByText('Blocking work')).toBeNull();
      expect(container.querySelector('[data-decision-id="conv-held"][data-blocking="true"]')).toBeNull();
      expect(screen.getByText('Held handoff — kickoff not sent')).toBeTruthy();
      expect(screen.getByText('Read the brief')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(1);
    });

    it('Open navigates to the conversation when no onOpenSubject is passed', async () => {
      vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([heldDecision]);
      renderWithQuery(<DecisionsPanel />);

      await userEvent.click(screen.getByRole('button', { name: 'Open' }));

      expect(window.location.pathname).toBe('/conv/conv-held');
    });

    it('Open calls onOpenSubject when one is passed', async () => {
      vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([heldDecision]);
      const onOpenSubject = vi.fn();
      renderWithQuery(<DecisionsPanel onOpenSubject={onOpenSubject} />);

      await userEvent.click(screen.getByRole('button', { name: 'Open' }));

      expect(onOpenSubject).toHaveBeenCalledWith(heldDecision);
      expect(window.location.pathname).toBe('/');
    });

    it('falls back to a fixed prompt without a focus', () => {
      const { heldKickoffFocus: _omit, ...withoutFocus } = heldDecision;
      vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([withoutFocus]);
      renderWithQuery(<DecisionsPanel />);
      expect(screen.getByText('Its kickoff was never sent. Open the conversation to start it.')).toBeTruthy();
    });

    it('a held row that also has a permission prompt keeps its Answer button', () => {
      vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([
        { ...heldDecision, kinds: ['permissionRequest', 'heldKickoff'], blocking: true },
      ]);
      renderWithQuery(<DecisionsPanel />);
      expect(screen.getByRole('button', { name: 'Answer' })).toBeTruthy();
    });
  });

  describe('turn-end label (PAN-4371)', () => {
    const turnEndDecision = {
      id: 'conv-20260929-0001',
      source: 'agent' as const,
      label: 'conv-20260929-0001',
      kinds: ['agentTurnEnded'],
      since: '2026-09-29T00:00:00.000Z',
      blocking: true,
      turnEndAssessment: { kind: 'asks_operator', confidence: 0.9, needsAnswer: true, model: 'm' },
    };

    it('shows the turn-end kind label when a confident assessment is present', () => {
      vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([turnEndDecision]);
      renderWithQuery(<DecisionsPanel />);
      expect(screen.getAllByText('Asked you a question').length).toBeGreaterThan(0);
    });

    it('falls back to "Answer the agent" without a turn-end assessment', () => {
      const { turnEndAssessment: _omit, ...withoutAssessment } = turnEndDecision;
      vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([withoutAssessment]);
      renderWithQuery(<DecisionsPanel />);
      expect(screen.getAllByText('Answer the agent').length).toBeGreaterThan(0);
    });
  });
});

describe('DecisionsCount', () => {
  it('counts agents and conversations together', () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([agentDecision, conversationDecision, planDecision]);
    renderWithQuery(<DecisionsCount />);
    expect(screen.getByTestId('decisions-count').textContent).toContain('3');
  });

  it('renders nothing when there is nothing waiting', () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([]);
    renderWithQuery(<DecisionsCount />);
    expect(screen.queryByTestId('decisions-count')).toBeNull();
  });
});
