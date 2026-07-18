import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BacklogSequencerPage } from '../BacklogSequencerPage';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const node = {
  issueId: 'PAN-3001',
  title: 'Promote this issue',
  rank: 1,
  size: 'S',
  importance: 'high',
  score: 90,
  condition: 'ok',
  dependsOn: [],
  why: 'Highest-value ready work',
  gate: 'auto',
  planning: 'planned',
  inPipeline: false,
  hasPrd: true,
  ready: true,
};

const book = {
  id: 'active-book',
  name: 'Active campaign',
  status: 'running',
  settings: { laneAConcurrency: 2, posture: 'open' },
  items: [],
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BacklogSequencerPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BacklogSequencerPage order-book promotion', () => {
  it('asks only for Lane A or B, persists to the target book, and links to /orders', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/backlog/sequence') return Response.json({ nodes: [node], edges: [] });
      if (url === '/api/backlog/sequencer-status') return Response.json({ running: false, total: 0, processed: 0, startedAt: null });
      if (url === '/api/orders' && !init?.method) return Response.json({ books: [book] });
      if (url === '/api/orders/active-book/items' && init?.method === 'POST') return Response.json({ ...book, items: [{ issue: node.issueId, lane: 'B', order: 1 }] });
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Order book' }));

    const dialog = screen.getByRole('dialog', { name: `Choose lane for ${node.issueId}` });
    expect(dialog).toHaveTextContent('Add to Active campaign');
    expect(dialog).toHaveTextContent('Lane A');
    expect(dialog).toHaveTextContent('Lane B');
    expect(dialog.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Open Order Book' })).toHaveAttribute('href', '/orders');

    fireEvent.click(screen.getByRole('button', { name: 'Lane B' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders/active-book/items', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ item: { issue: node.issueId, lane: 'B' } }),
    })));
    expect(await screen.findByRole('link', { name: 'Open order book' })).toHaveAttribute('href', '/orders');
  });
});
