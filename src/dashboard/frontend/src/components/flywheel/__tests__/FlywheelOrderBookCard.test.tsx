import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../orders/ProgressPanel', () => ({
  ProgressPanel: ({ book }: { book: { id: string } }) => <div data-testid="progress-panel">{book.id}</div>,
}));

import { FlywheelOrderBookCard } from '../FlywheelOrderBookCard';
import { renderWithQuery, stubFetch } from './fixtures';

function book(id: string, status: string) {
  return { id, name: `Book ${id}`, status, settings: { laneAConcurrency: 1, posture: 'open' }, items: [], createdAt: 'x', updatedAt: 'x', progress: { landed: 0, total: 0 } };
}

describe('FlywheelOrderBookCard (PAN-3964 FR-12)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the running book with a link to the Order Book page', async () => {
    stubFetch((url) => (url === '/api/orders'
      ? Response.json({ project: 'overdeck', books: [book('b-draft', 'draft'), book('b-run', 'running')] })
      : undefined));
    renderWithQuery(<FlywheelOrderBookCard />);
    expect(await screen.findByTestId('progress-panel')).toHaveTextContent('b-run');
    expect(screen.getByRole('link', { name: 'Open in Order Book' })).toHaveAttribute('href', '/orders?project=overdeck');
  });

  it('renders nothing when no book is running', async () => {
    const fetchMock = stubFetch((url) => (url === '/api/orders' ? Response.json({ books: [book('b-draft', 'draft')] }) : undefined));
    const { container } = renderWithQuery(<FlywheelOrderBookCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders'));
    await waitFor(() => expect(fetchMock.mock.results[0]?.type).toBe('return'));
    expect(screen.queryByTestId('progress-panel')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
