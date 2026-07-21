/**
 * PAN-2908 · C-VERB §3.9 gate — the wordy-transcript contract.
 *
 * A synthetic wordy transcript (10-paragraph turns, >6 tool rows) proves:
 * no turn renders beyond its line budget, command groups collapse, verdict
 * messages become structured cards, and per-turn expansion never remounts
 * the row (scroll anchor holds — the virtualizer re-measures in place).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TurnBody, TURN_LINE_BUDGET } from './messageRows';
import { WorkLogGroup } from './workLogRows';
import type { WorkLogEntry } from '../chat-types';

// ChatMarkdown pulls in the syntax-highlight chain; the gate asserts budget
// behavior, not markdown fidelity.
vi.mock('../ChatMarkdown', () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

function paragraphs(n: number, prefix = 'Paragraph'): string {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1} — the agent explains at length.`).join('\n\n');
}

describe('C-VERB gate: per-turn line budget', () => {
  it('collapses a 10-paragraph turn to digest + toggle, expands per-turn', () => {
    render(<TurnBody text={paragraphs(10)} streaming={false} />);

    // Digest leads; the rest is collapsed behind the budget toggle.
    expect(screen.getByText(/Paragraph 1 —/)).toBeInTheDocument();
    expect(screen.queryByText(/Paragraph 5 —/)).not.toBeInTheDocument();
    const toggle = screen.getByTestId('turn-budget-toggle');
    expect(toggle).toHaveTextContent(`▸ ${TURN_LINE_BUDGET + 3} more lines`);

    // Per-turn expansion reveals the body (never remounts the row).
    const row = toggle.parentElement;
    fireEvent.click(toggle);
    expect(screen.getByText(/Paragraph 5 —/)).toBeInTheDocument();
    expect(screen.getByTestId('turn-budget-toggle')).toHaveTextContent('▾ show less');
    expect(screen.getByTestId('turn-budget-toggle').parentElement).toBe(row);

    // …and collapses again.
    fireEvent.click(screen.getByTestId('turn-budget-toggle'));
    expect(screen.queryByText(/Paragraph 5 —/)).not.toBeInTheDocument();
  });

  it('renders short turns in full with no toggle', () => {
    render(<TurnBody text={paragraphs(3)} streaming={false} />);
    expect(screen.getByText(/Paragraph 3 —/)).toBeInTheDocument();
    expect(screen.queryByTestId('turn-budget-toggle')).not.toBeInTheDocument();
  });

  it('never collapses a streaming turn, however long', () => {
    render(<TurnBody text={paragraphs(12)} streaming />);
    expect(screen.getByText(/Paragraph 12 —/)).toBeInTheDocument();
    expect(screen.queryByTestId('turn-budget-toggle')).not.toBeInTheDocument();
  });
});

describe('C-VERB gate: verdict extraction', () => {
  it('renders a pass verdict card for completion messages', () => {
    render(<TurnBody text={'ALL CHECKS PASSED for PAN-2377. Review: passed. Tests: passed.\n\nFull write-up follows here.'} streaming={false} />);
    const card = screen.getByTestId('turn-verdict-card');
    expect(card).toHaveAttribute('data-tone', 'pass');
    expect(card).toHaveTextContent('✓');
    expect(card).toHaveTextContent('ALL CHECKS PASSED for PAN-2377');
  });

  it('renders a fail verdict card for changes-requested messages', () => {
    render(<TurnBody text={'Changes requested: 2 findings need attention before merge.'} streaming={false} />);
    const card = screen.getByTestId('turn-verdict-card');
    expect(card).toHaveAttribute('data-tone', 'fail');
    expect(card).toHaveTextContent('✗');
  });

  it('renders a glyph-led verdict from the leading check mark', () => {
    render(<TurnBody text={'✓ Ship it — everything is green.'} streaming={false} />);
    expect(screen.getByTestId('turn-verdict-card')).toHaveAttribute('data-tone', 'pass');
  });

  it('does not card an ordinary turn', () => {
    render(<TurnBody text={paragraphs(2)} streaming={false} />);
    expect(screen.queryByTestId('turn-verdict-card')).not.toBeInTheDocument();
  });

  it('does not card neutral mentions of "blocked" (over-fire guard)', () => {
    render(<TurnBody text={'Work is blocked by the upstream task finishing first.'} streaming={false} />);
    expect(screen.queryByTestId('turn-verdict-card')).not.toBeInTheDocument();
  });
});

describe('C-VERB gate: command groups collapse', () => {
  function entries(n: number): WorkLogEntry[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `e-${i}`,
      createdAt: '2026-07-20T00:00:00Z',
      label: i % 2 === 0 ? 'Bash' : 'wait',
      detail: `payload-${i}`,
      tone: 'tool' as const,
    }));
  }

  it('keeps only the newest entries visible with an overflow expander', () => {
    render(<WorkLogGroup entries={entries(60)} />);
    // Newest 6 visible; the earlier 54 collapse behind the expander.
    expect(screen.getByText(/payload-59/)).toBeInTheDocument();
    expect(screen.queryByText(/payload-10/)).not.toBeInTheDocument();
    const expander = screen.getByRole('button', { name: /Show 54 earlier/ });
    fireEvent.click(expander);
    expect(screen.getByText(/payload-10/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Collapse/ }));
    expect(screen.queryByText(/payload-10/)).not.toBeInTheDocument();
  });
});
