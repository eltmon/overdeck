import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDashboardStore } from '../../../lib/store';
import type { DerivedIssueState } from '../../../types';
import type { OrderBookView } from '../BookStrip';
import { ProgressPanel } from '../ProgressPanel';

function seedDerived(states: DerivedIssueState[]): void {
  useDashboardStore.setState({
    derivedIssueStateByIssueId: Object.fromEntries(states.map((state) => [state.issueId, state])),
  });
}

const at = '2026-07-18T12:00:00.000Z';
const book: OrderBookView = {
  id: '2026-07-18-progress',
  name: 'Progress',
  status: 'running',
  settings: { laneAConcurrency: 2, posture: 'drain' },
  items: [
    { issue: 'PAN-Q', lane: 'B', order: 2, prereqs: ['PAN-P'], reVerify: true, addedAt: at, addedBy: 'operator' },
    { issue: 'PAN-W', lane: 'B', order: 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
    { issue: 'PAN-R', lane: 'A', order: 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
    { issue: 'PAN-C', lane: 'A', order: 2, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
  ],
  runId: 'RUN-9',
  createdAt: at,
  updatedAt: at,
  progress: {
    total: 4,
    landed: 1,
    drained: false,
    items: [
      { issue: 'PAN-Q', closed: false, parked: false, terminal: false },
      { issue: 'PAN-W', closed: false, parked: false, terminal: false },
      { issue: 'PAN-R', closed: false, parked: false, terminal: false },
      { issue: 'PAN-C', closed: true, parked: false, terminal: true },
    ],
  },
};

const LIVE: DerivedIssueState[] = [
  { issueId: 'PAN-W', state: 'working' },
  { issueId: 'PAN-R', state: 'in-review' },
];

beforeEach(() => {
  seedDerived(LIVE);
});

describe('ProgressPanel', () => {
  it('renders every item with its derived status and the landed count', () => {
    render(<ProgressPanel book={book} />);

    expect(screen.getByText('1/4 landed')).toBeInTheDocument();
    expect(screen.getByText('PAN-Q').closest('[data-live-status]')).toHaveAttribute('data-live-status', 'queued');
    expect(screen.getByText('PAN-W').closest('[data-live-status]')).toHaveAttribute('data-live-status', 'working');
    expect(screen.getByText('PAN-R').closest('[data-live-status]')).toHaveAttribute('data-live-status', 'review');
    expect(screen.getByText('PAN-C').closest('[data-live-status]')).toHaveAttribute('data-live-status', 'closed');
  });

  it('shows four mechanical eligibility conditions for a held item', () => {
    render(<ProgressPanel book={book} />);

    const conditions = screen.getByLabelText('PAN-Q eligibility');
    expect(within(conditions).getByText(/Pickup posture/)).toHaveTextContent('✕');
    expect(within(conditions).getByText(/Serial B-slot free/)).toHaveTextContent('✕');
    expect(within(conditions).getByText(/Prereqs landed/)).toHaveTextContent('✕');
    expect(within(conditions).getByText(/PRD re-verified/)).toHaveTextContent('✕');
  });

  it('matches server eligibility for external prerequisites and terminal pipeline entries', () => {
    const eligibleBook: OrderBookView = {
      ...book,
      settings: { ...book.settings, posture: 'open' },
      items: book.items.map((item) => item.issue === 'PAN-Q' ? { ...item, reVerify: false } : item),
      prerequisiteTerminal: { 'PAN-P': true },
    };
    seedDerived([{ issueId: 'PAN-W', state: 'merged' }, { issueId: 'PAN-R', state: 'in-review' }]);

    render(<ProgressPanel book={eligibleBook} />);

    const conditions = screen.getByLabelText('PAN-Q eligibility');
    expect(within(conditions).getByText(/Pickup posture/)).toHaveTextContent('✓');
    expect(within(conditions).getByText(/Serial B-slot free/)).toHaveTextContent('✓');
    expect(within(conditions).getByText(/Prereqs landed/)).toHaveTextContent('✓');
    expect(within(conditions).getByText(/PRD re-verified/)).toHaveTextContent('✓');
  });

  it('uses status colors and announces a drained book', () => {
    render(<ProgressPanel book={{ ...book, progress: { ...book.progress, landed: 4, drained: true } }} />);

    expect(screen.getByText('PAN-Q').closest('[data-live-status]')).toHaveClass('border-l-transparent');
    expect(screen.getByText('PAN-W').closest('[data-live-status]')).toHaveClass('border-l-info', 'bg-info/[0.08]');
    expect(screen.getByText('PAN-R').closest('[data-live-status]')).toHaveClass('border-l-warning', 'bg-warning/[0.08]');
    expect(screen.getByText('PAN-C').closest('[data-live-status]')).toHaveClass('border-l-success', 'bg-success/[0.08]');
    expect(screen.getByText(/Order book drained/)).toBeInTheDocument();
  });
});
