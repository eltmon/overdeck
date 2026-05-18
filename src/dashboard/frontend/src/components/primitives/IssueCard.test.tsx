import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import IssueCard from './IssueCard';
import VerbBadge from './VerbBadge';
import type { PhaseGlyphPhase } from './PhaseGlyph';

const PHASES = ['todo', 'plan', 'work', 'review', 'ship', 'done'] satisfies PhaseGlyphPhase[];

const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

const BEAD_PHASE_FILL_CLASSES = {
  todo: 'bg-muted-foreground',
  plan: 'bg-signal-review',
  work: 'bg-info',
  review: 'bg-warning',
  ship: 'bg-signal-review',
  done: 'bg-success',
} satisfies Record<PhaseGlyphPhase, string>;

describe('IssueCard', () => {
  it('renders root with data-component="issue-card"', () => {
    render(
      <IssueCard
        issueId="PAN-1"
        phase="work"
        priority="high"
        title="Test title"
      />,
    );

    const card = screen.getByText('PAN-1').closest('[data-component="issue-card"]');
    expect(card).toHaveAttribute('data-issue-id', 'PAN-1');
    expect(card).toHaveAttribute('data-phase', 'work');
    expect(card).toHaveAttribute('data-priority', 'high');
  });

  it('implements PRD §4.7.6 spec values', () => {
    render(
      <IssueCard
        issueId="PAN-1"
        phase="work"
        priority="high"
        title="Test title"
      />,
    );

    const card = screen.getByText('PAN-1').closest('[data-component="issue-card"]');
    expect(card).toHaveClass('rounded-[var(--radius-xl)]');
    expect(card).toHaveClass('border');
    expect(card).toHaveClass('p-[12px]');
    expect(card).toHaveClass('pb-[10px]');
    expect(card).toHaveClass('hover:border-[rgb(255_255_255_/_14%)]');
    expect(card).toHaveStyle({ background: 'color-mix(in srgb, var(--background) 92%, white)' });

    // Priority bar inset 12px
    expect(card).toHaveClass('before:bottom-[12px]');
    expect(card).toHaveClass('before:top-[12px]');
  });

  it('renders priority border colors for all priorities', () => {
    const { container } = render(
      <div>
        {PRIORITIES.map((priority) => (
          <IssueCard
            key={priority}
            issueId={`PAN-${priority}`}
            phase="work"
            priority={priority}
            title="T"
          />
        ))}
      </div>,
    );

    for (const priority of PRIORITIES) {
      const card = container.querySelector(`[data-issue-id="PAN-${priority}"]`);
      expect(card).not.toBeNull();
    }

    const urgentCard = container.querySelector('[data-priority="urgent"]');
    expect(urgentCard).toHaveClass('before:bg-destructive');

    const highCard = container.querySelector('[data-priority="high"]');
    expect(highCard).toHaveClass('before:bg-warning');

    const mediumCard = container.querySelector('[data-priority="medium"]');
    expect(mediumCard).toHaveClass('before:bg-[rgb(255_255_255_/_22%)]');

    const lowCard = container.querySelector('[data-priority="low"]');
    expect(lowCard).toHaveClass('before:bg-transparent');
  });

  it('swaps stuck and merge-ready border colors', () => {
    const { container } = render(
      <div>
        <IssueCard issueId="PAN-stuck" phase="work" priority="high" title="Stuck" stuckCard />
        <IssueCard issueId="PAN-merge" phase="work" priority="high" title="Merge" mergeReadyCard />
        <IssueCard issueId="PAN-normal" phase="work" priority="high" title="Normal" />
      </div>,
    );

    const stuckCard = container.querySelector('[data-issue-id="PAN-stuck"]');
    expect(stuckCard?.getAttribute('style')).toContain(
      'border-color: color-mix(in srgb, var(--destructive) 32%, transparent)',
    );

    const mergeCard = container.querySelector('[data-issue-id="PAN-merge"]');
    expect(mergeCard?.getAttribute('style')).toContain(
      'border-color: color-mix(in srgb, var(--success) 32%, transparent)',
    );

    const normalCard = container.querySelector('[data-issue-id="PAN-normal"]');
    expect(normalCard?.getAttribute('style')).not.toContain(
      'border-color: color-mix(in srgb, var(--destructive) 32%, transparent)',
    );
    expect(normalCard?.getAttribute('style')).not.toContain(
      'border-color: color-mix(in srgb, var(--success) 32%, transparent)',
    );
  });

  it('renders bead progress bar with correct fill width and phase-colored fill', () => {
    const { container } = render(
      <div>
        {PHASES.map((phase) => (
          <IssueCard
            key={phase}
            issueId={`PAN-${phase}`}
            phase={phase}
            priority="medium"
            title="T"
            beads={{ closed: 3, total: 12 }}
          />
        ))}
      </div>,
    );

    for (const phase of PHASES) {
      const card = container.querySelector(`[data-issue-id="PAN-${phase}"]`);
      expect(card).toHaveTextContent('Beads 3/12');

      const fill = card?.querySelector('.block.h-full');
      expect(fill).toHaveStyle({ width: '25%' });
      expect(fill).toHaveClass(BEAD_PHASE_FILL_CLASSES[phase]);
    }
  });

  it('composes VerbBadge and never renders status colors on labels', () => {
    const { container } = render(
      <IssueCard
        issueId="PAN-1"
        phase="work"
        priority="high"
        title="Test"
        verbBadge={<VerbBadge variant="WORK RUNNING" />}
        labels={['bug', 'frontend']}
      />,
    );

    const verbBadge = container.querySelector('[data-component="verb-badge"]');
    expect(verbBadge).toHaveAttribute('data-variant', 'WORK RUNNING');

    const labelChips = container.querySelectorAll('.text-muted-foreground');
    // Labels should use muted-foreground, not status colors
    const labelTexts = Array.from(labelChips).map((el) => el.textContent);
    expect(labelTexts).toContain('bug');
    expect(labelTexts).toContain('frontend');
  });

  it('renders project mark, agent footer, runtime, and avatar', () => {
    const { container } = render(
      <IssueCard
        issueId="PAN-1"
        phase="work"
        priority="high"
        title="Test"
        project={{ name: 'Panopticon', markClassName: 'bg-primary' }}
        agent={{ name: 'work-agent-1', sub: 'Running' }}
        runtime="12m"
        assignee={{ name: 'Alex Doe' }}
      />,
    );

    const card = container.querySelector('[data-issue-id="PAN-1"]');
    const mark = card?.querySelector('.bg-primary');
    expect(mark).not.toBeNull();
    expect(screen.getByText('work-agent-1')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('12m')).toBeTruthy();
    expect(screen.getByText('AD')).toBeTruthy();
  });

  it('falls back to issueId for avatar initials when assignee is missing', () => {
    render(
      <IssueCard
        issueId="PAN-1148"
        phase="work"
        priority="high"
        title="Test"
      />,
    );

    expect(screen.getByText('PA')).toBeTruthy();
  });

  it('calls onOpen when clicked', () => {
    let openedId = '';
    render(
      <IssueCard
        issueId="PAN-1"
        phase="work"
        priority="high"
        title="Test"
        onOpen={(id) => { openedId = id; }}
      />,
    );

    screen.getByText('Test').closest('button')?.click();
    expect(openedId).toBe('PAN-1');
  });
});
