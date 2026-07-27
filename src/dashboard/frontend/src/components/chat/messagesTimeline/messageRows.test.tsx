/**
 * PAN-2908 · C-VERB §3.9 gate — the wordy-transcript contract AS AMENDED by
 * the operator (2026-07-20): turns render in FULL (the per-turn line-budget
 * collapse was shipped then rejected), completion messages become structured
 * verdict cards, and the pre-existing work-log group collapse stays.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TurnBody } from './messageRows';
import { WorkLogGroup } from './workLogRows';
import type { SubagentSummary, WorkLogEntry } from '../chat-types';

// ChatMarkdown pulls in the syntax-highlight chain; the gate asserts budget
// behavior, not markdown fidelity.
vi.mock('../ChatMarkdown', () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

function paragraphs(n: number, prefix = 'Paragraph'): string {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1} — the agent explains at length.`).join('\n\n');
}

describe('C-VERB gate: turns render in full (collapse rejected by operator)', () => {
  it('renders a 10-paragraph turn completely, with no budget toggle', () => {
    render(<TurnBody text={paragraphs(10)} streaming={false} />);
    expect(screen.getByText(/Paragraph 1 —/)).toBeInTheDocument();
    expect(screen.getByText(/Paragraph 10 —/)).toBeInTheDocument();
    expect(screen.queryByTestId('turn-budget-toggle')).not.toBeInTheDocument();
  });

  it('renders the full body after a verdict card too', () => {
    render(<TurnBody text={'ALL CHECKS PASSED for PAN-2377.\n\n' + paragraphs(8, 'Detail')} streaming={false} />);
    expect(screen.getByTestId('turn-verdict-card')).toBeInTheDocument();
    expect(screen.getByText(/Detail 8 —/)).toBeInTheDocument();
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

describe('C-VERB gate: command groups collapse (pre-existing)', () => {
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

describe('subagent transcript action', () => {
  const entry: WorkLogEntry = {
    id: 'toolu-subagent',
    createdAt: '2026-07-20T00:00:00Z',
    label: 'Task',
    toolTitle: 'Task',
    tone: 'tool',
    toolInput: {
      subagent_type: 'Explore',
      description: 'Trace the parser',
      prompt: 'Find the relevant message path.',
    },
  };
  const subagent: SubagentSummary = {
    agentId: 'subagent-1',
    agentType: 'Explore',
    description: 'Trace the parser',
    toolUseId: entry.id,
    spawnDepth: 1,
    status: 'done',
  };

  it('opens the matching subagent from an expanded Agent row without a raw JSON fallback', () => {
    const agentEntry = { ...entry, label: 'Agent', toolTitle: 'Agent' };
    const onOpenSubagent = vi.fn();
    render(
      <WorkLogGroup
        entries={[agentEntry]}
        subagentByToolUseId={new Map([[entry.id, subagent]])}
        onOpenSubagent={onOpenSubagent}
      />,
    );

    fireEvent.click(screen.getByText('Agent'));
    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByTestId('md')).toHaveTextContent('Find the relevant message path.');
    expect(screen.queryByText(/"subagent_type"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open subagent transcript' }));
    expect(onOpenSubagent).toHaveBeenCalledWith(entry.id);
  });

  it('omits the action when no subagent matches the tool use id', () => {
    render(<WorkLogGroup entries={[entry]} subagentByToolUseId={new Map()} onOpenSubagent={vi.fn()} />);

    fireEvent.click(screen.getByText('Task'));
    expect(screen.queryByRole('button', { name: 'Open subagent transcript' })).not.toBeInTheDocument();
  });
});
