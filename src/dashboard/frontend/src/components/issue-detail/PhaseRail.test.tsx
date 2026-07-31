/**
 * PAN-2908 · C-DETAIL — PhaseRail component tests.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhaseRail } from './PhaseRail';
import { phaseRailState } from '../../lib/simple/phases';

describe('PhaseRail (C-DETAIL/C-VOCAB)', () => {
  it('renders the six phases in order with rail states', () => {
    const { container } = render(<PhaseRail rail={phaseRailState('in_review_reviewers_running')} />);
    const steps = container.querySelectorAll('[data-component="phase-rail"] > [data-phase]');
    expect(steps).toHaveLength(6);
    expect([...steps].map((s) => s.getAttribute('data-phase'))).toEqual(['plan', 'work', 'review', 'test', 'ship', 'done']);
    expect(steps[2].getAttribute('data-state')).toBe('current');
    expect(steps[0].getAttribute('data-state')).toBe('done');
    expect(steps[5].getAttribute('data-state')).toBe('pending');
  });

  it('fires onSelectPhase on clickable steps; explicit conversation-less steps are disabled', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PhaseRail
        rail={phaseRailState('in_review_reviewers_running')}
        agents={{
          review: { name: 'review.correctness', live: true, hasConversation: true },
          test: { name: '', hasConversation: false },
        }}
        onSelectPhase={onSelect}
      />,
    );
    const steps = container.querySelectorAll('[data-component="phase-rail"] > [data-phase]');
    fireEvent.click(within(steps[2] as HTMLElement).getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('review');
    // explicitly conversation-less → disabled
    expect(within(steps[3] as HTMLElement).getByRole('button')).toBeDisabled();
    // queued without agent info → clickable (the shell decides what it means)
    expect(within(steps[4] as HTMLElement).getByRole('button')).not.toBeDisabled();
  });

  it('renders explicit skipped metadata as a dashed linked step and embeds phase progress', () => {
    const { container } = render(
      <PhaseRail
        rail={phaseRailState('in_review_reviewers_running')}
        meta={{
          test: {
            text: 'Skipped · no suite configured',
            href: 'https://overdeck.ai/configuration/projects',
            skipped: true,
          },
        }}
        trailing={{ ship: <div data-testid="compact-ship-progress">Rebasing</div> }}
      />,
    );

    const testStep = container.querySelector('[data-phase="test"]');
    expect(testStep).toHaveAttribute('data-skipped', 'true');
    expect(testStep).toHaveClass('border-dashed');
    expect(screen.getByRole('link', { name: 'Skipped · no suite configured' })).toHaveAttribute(
      'href',
      'https://overdeck.ai/configuration/projects',
    );
    expect(within(container.querySelector('[data-phase="ship"]') as HTMLElement).getByTestId('compact-ship-progress')).toBeInTheDocument();
  });

  it('marks the active phase and shows the live agent', () => {
    const { container } = render(
      <PhaseRail
        rail={phaseRailState('in_review_reviewers_running')}
        agents={{ review: { name: 'review.correctness', model: 'sonnet-5', live: true, hasConversation: true } }}
        activePhase="review"
      />,
    );
    expect(screen.getByText('review.correctness')).toBeInTheDocument();
    const review = container.querySelector('[data-phase="review"]');
    expect(review?.className).toContain('bg-primary/8');
  });
});
