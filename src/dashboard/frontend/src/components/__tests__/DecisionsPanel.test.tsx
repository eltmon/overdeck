import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { DecisionsPanel, DecisionsCount } from '../DecisionsPanel';
import * as useDecisionsModule from '../../lib/useDecisions';
import { useAskUserQuestionUiStore } from '../../lib/askUserQuestionUiStore';

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const agentDecision = {
  id: 'planning-pan-2760',
  source: 'agent' as const,
  label: 'PAN-2760',
  issueId: 'PAN-2760',
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

    expect(screen.getByText('PAN-2760')).toBeTruthy();
    expect(screen.getByText('Docs domain move')).toBeTruthy();
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

  it('shows the actual question text, not just the kind', () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([agentDecision]);
    renderWithQuery(<DecisionsPanel />);
    expect(screen.getByText('Which approach for crew create?')).toBeTruthy();
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
