/**
 * PAN-2908 · C-DETAIL — PhaseRail component tests.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhaseRail } from './PhaseRail';
import { phaseRailState } from '../../lib/simple/phases';

describe('PhaseRail (C-DETAIL/C-VOCAB)', () => {
  it('renders the six phases in order with rail states', () => {
    const { container } = render(<PhaseRail rail={phaseRailState('in_review_reviewers_running')} />);
    const steps = container.querySelectorAll('[data-component="phase-rail"] > button');
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
    const steps = container.querySelectorAll('[data-component="phase-rail"] > button');
    fireEvent.click(steps[2]);
    expect(onSelect).toHaveBeenCalledWith('review');
    // explicitly conversation-less → disabled
    expect((steps[3] as HTMLButtonElement).disabled).toBe(true);
    // queued without agent info → clickable (the shell decides what it means)
    expect((steps[4] as HTMLButtonElement).disabled).toBe(false);
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
