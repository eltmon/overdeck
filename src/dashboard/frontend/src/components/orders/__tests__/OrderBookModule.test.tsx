import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { FlywheelStatus, OrderBook } from '@overdeck/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderBookIssueChip, OrderBookModule } from '../OrderBookModule';

const at = '2026-07-18T12:00:00.000Z';
const book: OrderBook & { progress: { total: number; landed: number; drained: boolean; items: Array<{ issue: string; terminal: boolean }> } } = {
  id: 'active-book',
  name: 'Active campaign',
  status: 'running',
  settings: { laneAConcurrency: 2, posture: 'drain', postureReason: 'hold until main verifies' },
  items: [
    { issue: 'PAN-1', lane: 'A', order: 3, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
    { issue: 'PAN-2', lane: 'B', order: 11, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
  ],
  runId: 'RUN-9',
  createdAt: at,
  updatedAt: at,
  progress: { total: 2, landed: 1, drained: false, items: [{ issue: 'PAN-1', terminal: true }, { issue: 'PAN-2', terminal: false }] },
};

const status: FlywheelStatus = {
  runId: 'RUN-9', startedAt: at, elapsedMs: 1000,
  orchestrator: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high', ctxPercent: 20 },
  headline: { bugsFixed: 0, swarmItemsMerged: 0, swarmItemsTotal: 0, prsMerged: 0, awaitingUat: 0 },
  activePipeline: [{ issueId: 'PAN-2', title: 'Working', verb: 'working', status: 'running' }],
  substrateBugs: [], agents: [], parked: [], suggestions: [], openQuestions: [],
  system: { mainHead: 'abc1234', ramUsedMb: 1, ramTotalMb: 2, swapUsedMb: 0, swapTotalMb: 0, agentsActive: 1, agentsCap: 3 },
  orders: { bookId: book.id, bookName: book.name, landed: 1, total: 2, laneAInFlight: [], laneBInFlight: 'PAN-2', drained: false },
  ticks: 1, lastTickAt: at,
};

function renderWithQuery(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe('OrderBookModule', () => {
  it('renders a read-only live checklist and links edits to /orders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(book)));
    renderWithQuery(<OrderBookModule status={status} />);

    expect(screen.getByRole('link', { name: /Active campaign/ })).toHaveAttribute('href', '/orders');
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(await screen.findByText('A3 · book')).toBeInTheDocument();
    expect(screen.getByText('B11 · book')).toBeInTheDocument();
    expect(screen.getByText('PAN-1')).toBeInTheDocument();
    expect(screen.getAllByText('landed').find((element) => element.classList.contains('text-success'))).toBeInTheDocument();
    expect(screen.getByText('working')).toHaveClass('text-info');
    expect(screen.getByText(/Pickup on hold/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/release|add issue|remove/i)).not.toBeInTheDocument();
  });

  it('renders the issue position and book name only for active-book members', async () => {
    const fetchMock = vi.fn(async () => Response.json({ books: [book, { ...book, id: 'done-book', status: 'complete', items: [{ ...book.items[0], issue: 'PAN-9' }] }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = renderWithQuery(<OrderBookIssueChip issueId="PAN-2" />);

    const chip = await screen.findByRole('link', { name: 'B11 · book · Active campaign' });
    expect(chip).toHaveAttribute('href', '/orders');
    expect(chip).toHaveTextContent('B11 · book');
    expect(chip).toHaveTextContent('Active campaign');

    rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrderBookIssueChip issueId="PAN-404" /></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByRole('link')).not.toBeInTheDocument());
  });
});
