import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./IssueHeaderFacts', () => ({
  IssueStateBadge: () => <span data-testid="mock-badge" />,
  IssueCostChip: () => <span data-testid="mock-cost" />,
}));

import { IssueTitleRow } from './IssueTitleRow';

function renderRow(props: Partial<Parameters<typeof IssueTitleRow>[0]> = {}) {
  return render(
    <IssueTitleRow
      issueId="PAN-1"
      title="A real title"
      titleStatus="ready"
      agents={[]}
      leading={<span data-testid="slot-leading" />}
      actions={<span data-testid="slot-actions" />}
      trailing={<span data-testid="slot-trailing" />}
      {...props}
    />,
  );
}

function root(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-component="issue-title-row"]');
  if (!el) throw new Error('issue-title-row root missing');
  return el;
}

describe('IssueTitleRow (PAN-5246)', () => {
  it('renders the id, the title with its title attribute, the badge, the cost and the three slots in order', () => {
    const { container } = renderRow();

    const heading = screen.getByRole('heading', { name: 'A real title' });
    expect(heading).toHaveAttribute('title', 'A real title');

    const order = [
      screen.getByTestId('slot-leading'),
      screen.getByText('PAN-1'),
      heading,
      screen.getByTestId('mock-badge'),
      screen.getByTestId('mock-cost'),
      screen.getByTestId('slot-actions'),
      screen.getByTestId('slot-trailing'),
    ];
    const rowEl = root(container);
    for (const el of order) expect(rowEl.contains(el)).toBe(true);
    for (let i = 1; i < order.length; i += 1) {
      // DOCUMENT_POSITION_FOLLOWING: order[i] comes after order[i - 1].
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('uses an h2 by default and an h1 when asked', () => {
    const { container, unmount } = renderRow();
    expect(root(container).querySelector('h2')).not.toBeNull();
    expect(root(container).querySelector('h1')).toBeNull();
    unmount();

    const h1 = renderRow({ heading: 'h1' });
    expect(root(h1.container).querySelector('h1')).not.toBeNull();
    expect(root(h1.container).querySelector('h2')).toBeNull();
  });

  it('shows the title skeleton while the record loads', () => {
    renderRow({ title: null, titleStatus: 'loading' });

    expect(screen.getByTestId('issue-title-skeleton')).toBeInTheDocument();
  });

  it('wraps only when asked', () => {
    const plain = renderRow();
    expect(root(plain.container)).toHaveClass('h-[46px]');
    expect(root(plain.container)).not.toHaveClass('flex-wrap');
    plain.unmount();

    const wrapped = renderRow({ wrap: true });
    expect(root(wrapped.container)).toHaveClass('flex-wrap');
    expect(root(wrapped.container)).not.toHaveClass('h-[46px]');
  });
});
