import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { OrderBook } from '@overdeck/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderBookIssueChip } from '../OrderBookIssueChip';

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

function renderWithQuery(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe('OrderBookIssueChip', () => {
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
