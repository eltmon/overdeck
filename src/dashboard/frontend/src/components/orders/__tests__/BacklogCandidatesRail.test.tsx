import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderBookView } from '../BookStrip';
import { BacklogCandidatesRail } from '../BacklogCandidatesRail';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const book: OrderBookView = {
  id: '2026-07-18-current', name: 'Current', status: 'ready', settings: { laneAConcurrency: 2, posture: 'open' },
  items: [{ issue: 'PAN-2', lane: 'A', order: 1, prereqs: [], reVerify: false, addedAt: '2026-07-18T12:00:00.000Z', addedBy: 'operator' }],
  createdAt: '2026-07-18T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z',
  progress: { total: 1, landed: 0, drained: false },
};

afterEach(() => vi.unstubAllGlobals());

describe('BacklogCandidatesRail', () => {
  it('renders rank order, excludes in-book issues, and keeps rank as muted text', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json(book);
      return Response.json({ candidates: [
        { issue: 'PAN-3', rank: 3, why: 'third' },
        { issue: 'PAN-2', rank: 2, why: 'already in book' },
        { issue: 'PAN-1', rank: 1, why: 'first' },
      ] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onBookChange = vi.fn();
    render(<BacklogCandidatesRail book={book} onBookChange={onBookChange} />);

    expect(await screen.findByText('PAN-1')).toBeInTheDocument();
    expect(screen.queryByText('PAN-2')).not.toBeInTheDocument();
    const issueIds = screen.getAllByText(/PAN-[13]/).map((node) => node.textContent);
    expect(issueIds).toEqual(['PAN-1', 'PAN-3']);
    for (const rank of screen.getAllByTestId('sequence-rank')) {
      expect(rank).toHaveClass('text-muted-foreground');
      expect(rank).not.toHaveClass('rounded-sm');
    }

    fireEvent.click(screen.getAllByRole('button', { name: '+ A' })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/2026-07-18-current/items',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ item: { issue: 'PAN-1', lane: 'A' } }) }),
    ));
    expect(onBookChange).toHaveBeenCalledWith(book);
  });
});
