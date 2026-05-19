import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PhaseHeader, { type PhaseHeaderPhase } from './PhaseHeader';

const PHASES = ['ship', 'review', 'work', 'plan', 'todo'] satisfies PhaseHeaderPhase[];

const BORDER_CLASSES = {
  ship: 'border-t-success',
  review: 'border-t-warning',
  work: 'border-t-info',
  plan: 'border-t-signal-review',
  todo: 'border-t-[rgb(255_255_255_/_15%)]',
} satisfies Record<PhaseHeaderPhase, string>;

describe('PhaseHeader', () => {
  it('renders sticky token-colored headers for each lifecycle phase', () => {
    render(
      <div>
        {PHASES.map((phase) => (
          <PhaseHeader key={phase} phase={phase} count={3} />
        ))}
      </div>,
    );

    for (const phase of PHASES) {
      const header = screen.getByText(phase[0].toUpperCase() + phase.slice(1)).closest('[data-component="phase-header"]');

      expect(header).toHaveAttribute('data-phase', phase);
      expect(header).toHaveAttribute('data-variant', 'pipeline');
      expect(header).toHaveClass('sticky', 'top-0', 'z-[2]', 'border-t-2', 'border-b', 'backdrop-blur-[6px]', BORDER_CLASSES[phase]);
      expect(header?.querySelector('[data-component="phase-glyph"]')).toHaveAttribute('data-phase', phase);
    }
  });

  it('renders count, sub-line, right meta, and command deck padding', () => {
    render(
      <PhaseHeader
        phase="review"
        count={12}
        variant="command-deck"
        title="Review"
        subLine="3 blocked"
        rightMeta={<span>12m · $0.42</span>}
      />,
    );

    const header = screen.getByText('Review').closest('[data-component="phase-header"]');

    expect(header).toHaveAttribute('data-variant', 'command-deck');
    expect(header).toHaveClass('px-[22px]', 'pt-[10px]', 'pb-[8px]');
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('3 blocked')).toBeTruthy();
    expect(screen.getByText('12m · $0.42')).toBeTruthy();
  });
});
