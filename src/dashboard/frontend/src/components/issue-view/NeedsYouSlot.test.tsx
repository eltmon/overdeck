import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { IssueActionView } from '../IssueActionMenu/useIssueActions';
import type { IssueViewModel, OperatorNeedsYou } from './types';
import { NeedsYouSlot } from './NeedsYouSlot';
import { buildIssueViewModel } from './useIssueView';

afterEach(cleanup);

function modelWith(items: OperatorNeedsYou[]): IssueViewModel {
  return {
    header: { issueId: 'PAN-3356', phase: 'work' },
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
    ship: { status: 'pending', readyForMerge: false, mergeStep: null },
    activity: { sections: [], totalCost: 0, aggregateCost: null },
    resources: { exists: false },
    operator: { needsYou: items[0] ?? null, needsYouItems: items },
  };
}

function actionView(key: string, label: string, invoke = vi.fn()): IssueActionView {
  return {
    action: { key, label, description: `${label} description` } as IssueActionView['action'],
    enabled: true,
    isPending: false,
    invoke,
  };
}

const LADDER: Array<{ item: OperatorNeedsYou; title: string }> = [
  { item: { kind: 'awaiting_input', prompt: 'Which storage path should we use?' }, title: 'The agent is waiting for your answer' },
  { item: { kind: 'stuck', reason: 'Review is not converging' }, title: 'This issue is stuck' },
  { item: { kind: 'troubled', reason: 'Crash loop' }, title: 'The agent stopped after repeated failures' },
  { item: { kind: 'paused', reason: 'Operator pause' }, title: 'The agent is paused' },
  { item: { kind: 'stale_review' }, title: 'Review has leftover specialist sessions' },
  { item: { kind: 'blocker', reason: 'Required check failed' }, title: 'A merge blocker needs attention' },
  { item: { kind: 'pickup_gate' }, title: 'The plan is waiting for release' },
];

describe('NeedsYouSlot', () => {
  it.each(LADDER.map((entry, index) => [entry.title, index] as const))(
    'selects %s when every higher-priority signal is absent',
    (title, startIndex) => {
      const remaining = LADDER.slice(startIndex).map(({ item }) => item).reverse();
      render(<NeedsYouSlot model={modelWith(remaining)} actions={[]} />);

      expect(screen.getByText(title)).toBeInTheDocument();
      if (remaining.length > 1) {
        expect(screen.getByTestId('needs-you-slot')).toHaveTextContent(`+${remaining.length - 1} more`);
      } else {
        expect(screen.queryByText(/\+\d+ more/)).toBeNull();
      }
    },
  );

  it('renders one highest-priority item and counts all additional signals', () => {
    render(<NeedsYouSlot model={modelWith(LADDER.map(({ item }) => item).reverse())} actions={[]} />);

    expect(screen.getByText('The agent is waiting for your answer')).toBeInTheDocument();
    expect(screen.getByText(/Which storage path should we use/)).toBeInTheDocument();
    expect(screen.getByText('+6 more')).toBeInTheDocument();
    expect(screen.queryByText('This issue is stuck')).toBeNull();
  });

  it('prioritizes simultaneous valid signals without classifying a blocked review as stale', () => {
    const derived = buildIssueViewModel(
      'PAN-3356',
      'Cockpit redesign',
      'feature/pan-3356',
      'overdeck',
      {
        issueId: 'PAN-3356',
        reviewStatus: 'blocked',
        testStatus: 'pending',
        readyForMerge: false,
        updatedAt: '2026-07-31T00:00:00Z',
        stuck: true,
        stuckReason: 'Review is not converging',
        blockerReasons: [{ type: 'failing_checks', summary: 'Lint failed', detectedAt: '2026-07-31T00:00:00Z' }],
      },
      undefined,
      undefined,
      {
        issueId: 'PAN-3356',
        sections: [
          { type: 'work', sessionId: 'agent-pan-3356', model: 'sonnet-5', startedAt: '2026-07-31T00:00:00Z', duration: 1, status: 'running', awaitingInput: true, awaitingInputPrompt: 'Choose a path' },
          { type: 'reviewer', sessionId: 'reviewer-pan-3356', model: 'sonnet-5', startedAt: '2026-07-31T00:01:00Z', duration: 1, status: 'stopped' },
        ],
      },
      {
        'agent-pan-3356': {
          id: 'agent-pan-3356',
          issueId: 'PAN-3356',
          sessionId: 'agent-pan-3356',
          role: 'work',
          model: 'sonnet-5',
          runtime: 'claude-code',
          status: 'running',
          startedAt: '2026-07-31T00:00:00Z',
          paused: true,
          troubled: true,
        } as never,
      },
      undefined,
      { identifier: 'PAN-3356', labels: ['ready'], hasPlan: true } as never,
    );

    expect(derived.operator.needsYouItems.map((item) => item.kind)).toEqual([
      'awaiting_input',
      'stuck',
      'troubled',
      'paused',
      'blocker',
      'pickup_gate',
    ]);
  });

  it('renders null when no operator signal is active', () => {
    const { container } = render(<NeedsYouSlot model={modelWith([])} actions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('invokes the matching shared registry action', () => {
    const invoke = vi.fn();
    const actions = [actionView('unpause', 'Unpause agent', invoke)];
    render(<NeedsYouSlot model={modelWith([{ kind: 'paused' }])} actions={actions} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unpause agent' }));
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('resolves agent-scoped actions outside the protected issue action menu', () => {
    const registryInvoke = vi.fn();
    const targetedInvoke = vi.fn();
    const resolveAgentAction = vi.fn(() => ({
      label: 'Unpause agent',
      description: 'Unpause this exact agent.',
      enabled: true,
      isPending: false,
      invoke: targetedInvoke,
    }));
    render(
      <NeedsYouSlot
        model={modelWith([{ kind: 'paused', sessionId: 'agent-pan-3356-review-security' }])}
        actions={[actionView('unpause', 'Unpause agent', registryInvoke)]}
        resolveAgentAction={resolveAgentAction}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Unpause agent' }));

    expect(resolveAgentAction).toHaveBeenCalledWith({
      kind: 'paused',
      sessionId: 'agent-pan-3356-review-security',
    });
    expect(targetedInvoke).toHaveBeenCalledOnce();
    expect(registryInvoke).not.toHaveBeenCalled();
  });

  it.each([
    ['stale_review', 'Stale-review warning'],
    ['blocker', 'IssueBlockerSpotlight'],
    ['pickup_gate', 'PickupGateCard'],
  ] as const)('renders the absorbed %s section marker', (kind, marker) => {
    const { container } = render(<NeedsYouSlot model={modelWith([{ kind }])} actions={[]} />);
    expect(screen.getByTestId('needs-you-slot')).toHaveAttribute('data-section', 'NeedsYouSlot');
    expect(container.querySelector(`[data-section="${marker}"]`)).toBeInTheDocument();
  });
});
