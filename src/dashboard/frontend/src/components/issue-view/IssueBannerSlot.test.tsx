import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Agent } from '../../types';
import type { IssueViewModel, OperatorNeedsYou } from './types';
import { IssueBannerSlot } from './IssueBannerSlot';
import { useNeedsYouActions } from './useNeedsYouActions';

const unpauseMutate = vi.fn();
const recoverMutate = vi.fn();

vi.mock('../../lib/simple/useSimpleActions', () => ({
  useSimpleActions: () => ({
    unpause: { mutate: unpauseMutate, isPending: false },
    recover: { mutate: recoverMutate, isPending: false },
  }),
}));
vi.mock('../IssueActionMenu/useIssueActions', () => ({
  useIssueActions: () => ({ all: [] }),
}));

const useIssueViewMock = vi.fn();
vi.mock('./useIssueView', () => ({
  useIssueView: (...args: unknown[]) => useIssueViewMock(...args),
}));

afterEach(cleanup);

function modelWith(items: OperatorNeedsYou[]): IssueViewModel {
  return {
    header: { issueId: 'PAN-1', phase: 'work' },
    narrative: { now: 'Working', nextAction: 'Wait', recentEvents: [] },
    pipeline: {
      plan: { status: 'passed', active: false, done: true },
      work: { status: 'running', active: true, done: false },
      review: { status: 'pending', active: false, done: false },
      test: { status: 'pending', active: false, done: false },
      ship: { status: 'pending', active: false, done: false },
    },
    agents: [],
    verification: { status: 'pending', gates: [] },
    ship: { status: 'pending' },
    activity: { sections: [], totalCost: 0, aggregateCost: null },
    resources: { exists: false },
    operator: { needsYou: items[0] ?? null, needsYouItems: items },
  };
}

function agent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-05-22T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

function renderSlot(items: OperatorNeedsYou[], agents: Agent[], onOpenAgentConversation = vi.fn()) {
  useIssueViewMock.mockReturnValue(modelWith(items));
  return render(
    <IssueBannerSlot issueId="PAN-1" agents={agents} onOpenAgentConversation={onOpenAgentConversation} />,
  );
}

describe('IssueBannerSlot', () => {
  it('renders nothing visible when there is no item and no paused agent', () => {
    renderSlot([], []);
    expect(screen.getByTestId('issue-banner-slot')).toHaveAttribute('data-banner', 'none');
    expect(screen.queryByTestId('needs-you-slot')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drawer-paused-banner')).not.toBeInTheDocument();
  });

  it('shows the paused banner for a paused agent', () => {
    renderSlot([], [agent({ id: 'agent-pan-1-work-1', paused: true })]);
    expect(screen.getByTestId('issue-banner-slot')).toHaveAttribute('data-banner', 'paused');
    expect(screen.getByTestId('drawer-paused-banner')).toBeInTheDocument();
  });

  it('the paused banner outranks a blocker item', () => {
    renderSlot(
      [{ kind: 'blocker', reason: 'Required check failed' }],
      [agent({ id: 'agent-pan-1-work-1', paused: true })],
    );
    expect(screen.getByTestId('issue-banner-slot')).toHaveAttribute('data-banner', 'paused');
    expect(screen.getByTestId('drawer-paused-banner')).toBeInTheDocument();
  });

  it('a waiting agent outranks the paused banner', () => {
    renderSlot(
      [{ kind: 'awaiting_input', prompt: 'Which storage path should we use?' }, { kind: 'paused' }],
      [agent({ id: 'agent-pan-1-work-1', paused: true })],
    );
    expect(screen.getByTestId('issue-banner-slot')).toHaveAttribute('data-banner', 'needs-you');
    expect(screen.getByText(/Which storage path should we use\?/)).toBeInTheDocument();
  });

  it('shows the blocker item with the IssueBlockerSpotlight marker when nothing is paused', () => {
    renderSlot([{ kind: 'blocker', reason: 'Required check failed' }], []);
    expect(screen.getByTestId('issue-banner-slot')).toHaveAttribute('data-banner', 'needs-you');
    expect(document.querySelector('[data-section="IssueBlockerSpotlight"]')).toBeInTheDocument();
  });

  it('Open conversation calls back with the exact agent id', () => {
    const onOpenAgentConversation = vi.fn();
    renderSlot(
      [{ kind: 'awaiting_input', sessionId: 'agent-pan-1-review-security', prompt: 'Which storage path should we use?' }],
      [agent({ id: 'agent-pan-1-review-security' })],
      onOpenAgentConversation,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
    expect(onOpenAgentConversation).toHaveBeenCalledWith('agent-pan-1-review-security');
  });

  it('Open conversation is disabled while the agent is unknown', () => {
    renderSlot(
      [{ kind: 'awaiting_input', sessionId: 'agent-pan-1-review-security', prompt: 'Which storage path should we use?' }],
      [],
    );
    expect(screen.getByRole('button', { name: 'Open conversation' })).toBeDisabled();
  });

  it('the paused action targets the exact non-primary agent', () => {
    let invoke: (() => void) | undefined;
    function Probe() {
      const resolveAction = useNeedsYouActions(new Map([['agent-pan-1-review-security', 'agent-pan-1-review-security']]), vi.fn());
      invoke = resolveAction({ kind: 'paused', sessionId: 'agent-pan-1-review-security' })?.invoke;
      return null;
    }
    render(<Probe />);
    invoke?.();
    expect(unpauseMutate).toHaveBeenCalledWith({ agentId: 'agent-pan-1-review-security' });
  });

  it('resolves a Herdr terminalId session id to the real agent id for Open conversation', () => {
    const onOpenAgentConversation = vi.fn();
    let invoke: (() => void) | undefined;
    function Probe() {
      const resolveAction = useNeedsYouActions(new Map([['term_abc123', 'agent-pan-1-review-security']]), onOpenAgentConversation);
      invoke = resolveAction({ kind: 'awaiting_input', sessionId: 'term_abc123', prompt: 'Which storage path?' })?.invoke;
      return null;
    }
    render(<Probe />);
    invoke?.();
    expect(onOpenAgentConversation).toHaveBeenCalledWith('agent-pan-1-review-security');
  });

  it.each([
    ['none', [] as OperatorNeedsYou[], [] as Agent[]],
    ['paused', [] as OperatorNeedsYou[], [agent({ id: 'agent-pan-1-work-1', paused: true })]],
    ['needs-you', [{ kind: 'blocker', reason: 'Required check failed' }] as OperatorNeedsYou[], [] as Agent[]],
  ] as const)('the root keeps the DrawerPausedBanner marker in every state (%s)', (_label, items, agents) => {
    renderSlot(items, agents);
    expect(document.querySelector('[data-section="DrawerPausedBanner"]')).toBeInTheDocument();
  });
});
