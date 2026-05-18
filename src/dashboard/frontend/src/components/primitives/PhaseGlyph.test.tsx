import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PhaseGlyph, { type PhaseGlyphPhase } from './PhaseGlyph';

const PHASES = ['todo', 'plan', 'work', 'review', 'ship', 'done'] satisfies PhaseGlyphPhase[];

const PHASE_CLASSES = {
  todo: 'text-muted-foreground',
  plan: 'text-signal-review-foreground',
  work: 'text-info-foreground',
  review: 'text-warning-foreground',
  ship: 'text-signal-review-foreground',
  done: 'text-success-foreground',
} satisfies Record<PhaseGlyphPhase, string>;

describe('PhaseGlyph', () => {
  it('renders each phase as a 14px token-colored SVG', () => {
    render(
      <div>
        {PHASES.map((phase) => (
          <PhaseGlyph key={phase} phase={phase} data-testid={`phase-${phase}`} />
        ))}
      </div>,
    );

    for (const phase of PHASES) {
      const glyph = screen.getByTestId(`phase-${phase}`);

      expect(glyph).toHaveAttribute('data-component', 'phase-glyph');
      expect(glyph).toHaveAttribute('data-phase', phase);
      expect(glyph).toHaveAttribute('viewBox', '0 0 14 14');
      expect(glyph).toHaveAttribute('stroke', 'currentColor');
      expect(glyph).toHaveClass('h-[14px]', 'w-[14px]', PHASE_CLASSES[phase]);
    }
  });
});
