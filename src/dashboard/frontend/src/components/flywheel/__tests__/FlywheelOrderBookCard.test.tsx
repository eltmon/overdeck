import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlywheelOrderBookCard } from '../FlywheelOrderBookCard';
import { renderWithQuery, stubFetch } from './fixtures';

function book(id: string, status: string, phase: string, issues: string[] = []) {
  return {
    id, name: `Book ${id}`, status, phase, queuePosition: phase === 'active' ? 1 : null, finished: false,
    settings: { laneAConcurrency: 1, posture: 'open' },
    items: issues.map((issue, index) => ({ issue, lane: 'A', order: index + 1, prereqs: [], reVerify: false, addedAt: 'x', addedBy: 'operator' })),
    createdAt: 'x', updatedAt: 'x', progress: { landed: 0, total: issues.length, drained: false },
  };
}

describe('FlywheelOrderBookCard (PAN-3964 FR-12, PAN-5597)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the active book when no book has status running', async () => {
    stubFetch((url) => (url === '/api/orders'
      ? Response.json({ project: 'overdeck', books: [book('b-draft', 'draft', 'draft'), book('b-ready', 'ready', 'active', ['PAN-1'])] })
      : undefined));
    renderWithQuery(<FlywheelOrderBookCard />);
    expect(await screen.findByText('Order book · Book b-ready')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Parallel lane' })).toBeInTheDocument();
    expect(document.querySelector('[data-issue="PAN-1"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('labels an eligible row by whether the Flywheel is running', async () => {
    let run = 'stopped';
    stubFetch((url) => {
      if (url === '/api/orders') return Response.json({ project: 'p1', books: [book('b1', 'ready', 'active', ['PAN-1'])] });
      if (url === '/api/flywheel/status') return Response.json({ run });
      return undefined;
    });
    renderWithQuery(<FlywheelOrderBookCard />);
    expect(await screen.findByText('Ready, Flywheel is stopped')).toBeInTheDocument();
    run = 'running';
    cleanup();
    renderWithQuery(<FlywheelOrderBookCard />);
    expect(await screen.findByText('Starts next')).toBeInTheDocument();
  });

  it('links to the book with project and book parameters', async () => {
    stubFetch((url) => (url === '/api/orders'
      ? Response.json({ project: 'p1', books: [book('b1', 'ready', 'active')] })
      : undefined));
    renderWithQuery(<FlywheelOrderBookCard />);
    expect(await screen.findByRole('link', { name: 'Open in Order books' })).toHaveAttribute('href', '/orders?project=p1&book=b1');
  });

  it('renders nothing when no book is active', async () => {
    const fetchMock = stubFetch((url) => (url === '/api/orders'
      ? Response.json({ books: [book('b-draft', 'draft', 'draft'), book('b-old', 'complete', 'archived')] })
      : undefined));
    const { container } = renderWithQuery(<FlywheelOrderBookCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders'));
    await waitFor(() => expect(fetchMock.mock.results[0]?.type).toBe('return'));
    expect(container).toBeEmptyDOMElement();
  });
});
