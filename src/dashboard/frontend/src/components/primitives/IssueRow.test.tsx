import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import IssueRow, { type IssueRowPriority } from './IssueRow';
import VerbBadge from './VerbBadge';

const PRIORITY_CLASSES = {
  urgent: 'before:bg-destructive',
  high: 'before:bg-warning',
  medium: 'before:bg-[rgb(255_255_255_/_22%)]',
  low: 'before:bg-transparent',
} satisfies Record<IssueRowPriority, string>;

function renderIssueRow(priority: IssueRowPriority = 'high') {
  const onOpen = vi.fn();
  render(
    <IssueRow
      issueId="PAN-123"
      phase="ship"
      priority={priority}
      title="Ship dashboard redesign"
      project={{ name: 'Panopticon', markClassName: 'bg-primary' }}
      labels={['frontend', 'design']}
      verbBadge={<VerbBadge variant="WORK RUNNING" />}
      agent={{ name: 'agent-pan-123', sub: 'opus · 18m' }}
      ledger={{ runtime: '18m', cost: '$1.42' }}
      assignee={{ name: 'Jane Doe' }}
      onOpen={onOpen}
    />,
  );
  return { onOpen, row: screen.getByText('PAN-123').closest('[data-component="issue-row"]') as HTMLElement };
}

describe('IssueRow', () => {
  it('renders the pipeline layout with phase glyph, verb badge, taxonomy labels, ledger, and avatar', () => {
    const { onOpen, row } = renderIssueRow();

    expect(row).toHaveAttribute('data-issue-id', 'PAN-123');
    expect(row).toHaveAttribute('data-phase', 'ship');
    expect(row).toHaveAttribute('data-priority', 'high');
    expect(row).toHaveAttribute('data-variant', 'pipeline');
    expect(row).toHaveClass('grid', 'gap-[14px]', 'py-[10px]', 'pl-[18px]', 'pr-[22px]', 'before:bg-warning');
    expect(row.getAttribute('style')).toContain('grid-template-columns: 14px 78px 14px 1fr 220px 84px 30px;');

    expect(row.querySelector('[data-component="phase-glyph"]')).toHaveAttribute('data-phase', 'ship');
    expect(row.querySelector('[data-component="verb-badge"]')).toHaveAttribute('data-variant', 'WORK RUNNING');

    const frontendLabel = screen.getByText('frontend');
    const designLabel = screen.getByText('design');
    expect(frontendLabel).toHaveClass('bg-muted', 'text-muted-foreground');
    expect(designLabel).toHaveClass('bg-muted', 'text-muted-foreground');

    const ledger = row.querySelector('[data-component="issue-row-ledger"]') as HTMLElement;
    expect(within(ledger).getByText('18m')).toHaveClass('text-muted-foreground');
    expect(within(ledger).getByText('$1.42')).toHaveClass('text-signal-cost-foreground');

    expect(row.querySelector('[data-component="issue-row-avatar"]')).toHaveTextContent('JD');

    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('PAN-123');
  });

  it('renders command-deck density and empty ledger state', () => {
    render(
      <IssueRow
        issueId="PAN-456"
        phase="work"
        priority="low"
        title="Queued dashboard work"
        variant="command-deck"
      />,
    );

    const row = screen.getByText('PAN-456').closest('[data-component="issue-row"]') as HTMLElement;
    const ledger = row.querySelector('[data-component="issue-row-ledger"]') as HTMLElement;

    expect(row).toHaveAttribute('data-variant', 'command-deck');
    expect(row).toHaveClass('gap-[12px]', 'py-[9px]', 'pl-[18px]', 'pr-[22px]', 'before:bg-transparent');
    expect(row.getAttribute('style')).toContain('grid-template-columns: 14px 78px 14px 1fr 220px 84px 26px;');
    expect(ledger).toHaveClass('opacity-55');
    expect(within(ledger).getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('Unassigned')).toHaveClass('italic', 'text-muted-foreground');
  });

  it('maps every priority to the expected pseudo-border token class', () => {
    render(
      <div>
        {Object.keys(PRIORITY_CLASSES).map((priority) => (
          <IssueRow
            key={priority}
            issueId={`PAN-${priority}`}
            phase="todo"
            priority={priority as IssueRowPriority}
            title={`${priority} issue`}
          />
        ))}
      </div>,
    );

    for (const [priority, className] of Object.entries(PRIORITY_CLASSES)) {
      const row = screen.getByText(`${priority} issue`).closest('[data-component="issue-row"]');
      expect(row).toHaveClass(className);
    }
  });
});
