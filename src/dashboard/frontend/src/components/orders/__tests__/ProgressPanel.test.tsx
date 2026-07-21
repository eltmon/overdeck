import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FlywheelStatus } from '@overdeck/contracts';

import type { OrderBookView } from '../BookStrip';
import { ProgressPanel } from '../ProgressPanel';

vi.mock('../../../lib/wsTransport', () => ({
  subscribeFlywheelStatus: vi.fn(() => vi.fn()),
}));

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

function flywheelStatus(drained = false): FlywheelStatus {
  return {
    runId: 'RUN-9',
    startedAt: at,
    elapsedMs: 1000,
    orchestrator: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', ctxPercent: 20 },
    headline: { bugsFixed: 0, swarmItemsMerged: 0, swarmItemsTotal: 0, prsMerged: 0, awaitingUat: 0 },
    activePipeline: [
      { issueId: 'PAN-W', title: 'Working', verb: 'working', status: 'running' },
      { issueId: 'PAN-R', title: 'Review', verb: 'reviewing', status: 'running' },
    ],
    substrateBugs: [], agents: [], parked: [], suggestions: [],
    system: { mainHead: 'abc1234', ramUsedMb: 1, ramTotalMb: 2, swapUsedMb: 0, swapTotalMb: 0, agentsActive: 2, agentsCap: 3 },
    openQuestions: [],
    orders: { bookId: book.id, bookName: book.name, landed: drained ? 4 : 1, total: 4, laneAInFlight: ['PAN-R'], laneBInFlight: 'PAN-W', drained },
    ticks: 1,
    lastTickAt: at,
  };
}

describe('ProgressPanel', () => {
  it('renders every item with live status and the landed count', () => {
    render(<ProgressPanel book={book} initialStatus={flywheelStatus()} onOpenReport={vi.fn()} />);

    expect(screen.getByText('1/4 landed')).toBeInTheDocument();
    expect(screen.getByText('PAN-Q').closest('[data-live-status]')).toHaveAttribute('data-live-status', 'queued');
    expect(screen.getByText('PAN-W').closest('[data-live-status]')).toHaveAttribute('data-live-status', 'working');
    expect(screen.getByText('PAN-R').closest('[data-live-status]')).toHaveAttribute('data-live-status', 'review');
    expect(screen.getByText('PAN-C').closest('[data-live-status]')).toHaveAttribute('data-live-status', 'closed');
  });

  it('shows four mechanical eligibility conditions for a held item', () => {
    render(<ProgressPanel book={book} initialStatus={flywheelStatus()} onOpenReport={vi.fn()} />);

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
    const status = flywheelStatus();
    status.activePipeline = status.activePipeline.map((item) =>
      item.issueId === 'PAN-W' ? { ...item, status: 'merged' as const } : item,
    );
    const { laneBInFlight: _terminalLaneB, ...orders } = status.orders!;
    status.orders = orders;

    render(<ProgressPanel book={eligibleBook} initialStatus={status} onOpenReport={vi.fn()} />);

    const conditions = screen.getByLabelText('PAN-Q eligibility');
    expect(within(conditions).getByText(/Pickup posture/)).toHaveTextContent('✓');
    expect(within(conditions).getByText(/Serial B-slot free/)).toHaveTextContent('✓');
    expect(within(conditions).getByText(/Prereqs landed/)).toHaveTextContent('✓');
    expect(within(conditions).getByText(/PRD re-verified/)).toHaveTextContent('✓');
  });

  it('uses status colors and links the report when drained', () => {
    const onOpenReport = vi.fn();
    render(<ProgressPanel book={book} initialStatus={flywheelStatus(true)} onOpenReport={onOpenReport} />);

    expect(screen.getByText('PAN-Q').closest('[data-live-status]')).toHaveClass('border-l-transparent');
    expect(screen.getByText('PAN-W').closest('[data-live-status]')).toHaveClass('border-l-info', 'bg-info/[0.08]');
    expect(screen.getByText('PAN-R').closest('[data-live-status]')).toHaveClass('border-l-warning', 'bg-warning/[0.08]');
    expect(screen.getByText('PAN-C').closest('[data-live-status]')).toHaveClass('border-l-success', 'bg-success/[0.08]');
    expect(screen.getByText(/Order book drained/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open report & retro/ }));
    expect(onOpenReport).toHaveBeenCalledWith('RUN-9');
  });
});
