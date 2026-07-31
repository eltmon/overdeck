import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRowModel, IssueShipModel } from '../../issue-view/types';
import { CockpitPhaseRail } from './CockpitPhaseRail';

vi.mock('../../../lib/useSharedTick', () => ({
  useSharedTick: () => new Date('2026-07-31T12:05:00Z'),
}));

const reviewer: AgentRowModel = {
  sessionId: 'agent-pan-3356-review-correctness',
  type: 'reviewer',
  label: 'Correctness',
  icon: 'reviewer-correctness',
  role: 'correctness',
  status: 'running',
  active: true,
  model: 'sonnet-5',
  harness: 'claude-code',
  startedAt: '2026-07-31T12:00:00Z',
  duration: null,
  verdict: null,
  pendingInput: false,
};

const ship: IssueShipModel = {
  status: 'merging',
  readyForMerge: false,
  mergeStep: 'rebasing',
  log: null,
};

describe('CockpitPhaseRail', () => {
  it('shows live actor metadata from the shared tick without changing the drawer rail', () => {
    render(
      <CockpitPhaseRail
        pipelineState="in_review_reviewers_running"
        agents={[reviewer]}
        ship={ship}
        onSelectPhase={vi.fn()}
      />,
    );

    const review = screen.getByRole('button', { name: /Review/ });
    expect(review).toHaveTextContent('Live · 5m');
    expect(review).toHaveTextContent('Correctness · sonnet-5 · claude-code');
    expect(within(review).getByText(/Started Jul 31/)).toHaveAttribute('datetime', reviewer.startedAt);
  });

  it('passes the exact displayed session through phase clicks', () => {
    const onSelectPhase = vi.fn();
    render(
      <CockpitPhaseRail
        pipelineState="in_review_reviewers_running"
        agents={[reviewer]}
        ship={ship}
        onSelectPhase={onSelectPhase}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Review/ }));

    expect(onSelectPhase).toHaveBeenCalledWith('review', reviewer.sessionId);
  });

  it('renders skipped-test guidance, embedded ship progress, and phase navigation', () => {
    const onSelectPhase = vi.fn();
    const { container } = render(
      <CockpitPhaseRail
        pipelineState="in_review_reviewers_running"
        agents={[reviewer]}
        ship={ship}
        testStatus="skipped"
        onSelectPhase={onSelectPhase}
      />,
    );

    expect(screen.getByRole('link', { name: 'Configure tests' })).toHaveAttribute(
      'href',
      'https://overdeck.ai/configuration/projects',
    );
    expect(container.querySelector('[data-phase="test"]')).toHaveAttribute('data-skipped', 'true');
    expect(container.querySelector('[data-section="ship-progress-compact"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Plan/ }));
    expect(onSelectPhase).toHaveBeenCalledWith('plan', undefined);
  });
});
