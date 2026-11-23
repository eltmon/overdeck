import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MoreSettings } from '../MoreSettings';
import type { OrderBookView } from '../types';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const at = '2026-11-22T12:00:00.000Z';
const book: OrderBookView = {
  id: 'book-1', name: 'Book', status: 'draft', phase: 'draft', queuePosition: null, finished: false,
  settings: { laneAConcurrency: 2, posture: 'open' }, items: [], createdAt: at, updatedAt: at,
  progress: { total: 0, landed: 0, drained: false },
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('MoreSettings', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces the extra instructions save', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ...book, settings: { ...book.settings, briefOverlay: 'docs/brief.md' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onBookChange = vi.fn();
    render(<MoreSettings book={book} project="overdeck" onBookChange={onBookChange} />);

    const input = screen.getByLabelText('Extra instructions file');
    fireEvent.change(input, { target: { value: 'docs/br' } });
    fireEvent.change(input, { target: { value: 'docs/brief.md' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(549); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/book-1?project=overdeck', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ settings: { briefOverlay: 'docs/brief.md' } }),
    }));
    expect(onBookChange).toHaveBeenCalled();
    expect(screen.getByText("Added to every issue's kickoff brief.")).toBeInTheDocument();
  });

  it('rejects a path that does not end in .md', async () => {
    const fetchMock = vi.fn(async () => Response.json(book));
    vi.stubGlobal('fetch', fetchMock);
    render(<MoreSettings book={book} />);

    fireEvent.change(screen.getByLabelText('Extra instructions file'), { target: { value: 'docs/brief.txt' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Not a markdown file. Use a repo path that ends in .md.')).toBeInTheDocument();
  });

  it('previews the brief', async () => {
    const fetchMock = vi.fn(async () => Response.json({ brief: '# Special orders: Book\n' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MoreSettings book={book} project="overdeck" />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview what the Flywheel receives' }));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('/api/orders/book-1/preview-brief?project=overdeck', undefined);
    const preview = screen.getByLabelText('Brief preview');
    expect(preview.tagName).toBe('PRE');
    expect(preview).toHaveTextContent('# Special orders: Book');
  });
});
