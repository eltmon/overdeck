import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BookHeader } from '../BookHeader';
import type { OrderBookView } from '../types';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const at = '2026-11-22T12:00:00.000Z';

function book(overrides: Partial<OrderBookView> = {}): OrderBookView {
  return {
    id: 'book-1', name: 'Workflow redesign', status: 'ready', phase: 'active', queuePosition: 1, finished: false,
    settings: { laneAConcurrency: 2, posture: 'open' }, items: [], createdAt: at, updatedAt: at,
    progress: { total: 2, landed: 1, drained: false },
    validation: { blocks: [], warns: [] },
    ...overrides,
  };
}

function stubFetch(response: unknown = book()) {
  const fetchMock = vi.fn(async () => Response.json(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const call = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  return JSON.parse(String(call[1].body));
}

afterEach(() => vi.unstubAllGlobals());

describe('BookHeader', () => {
  it('disables Queue book while the draft has blocking findings', () => {
    render(<BookHeader
      book={book({ status: 'draft', phase: 'draft', queuePosition: null, validation: { blocks: [{ code: 'issue-not-open', issue: 'PAN-1', message: 'PAN-1 is not open' }], warns: [] } })}
      flywheelRunning
    />);
    const queue = screen.getByRole('button', { name: 'Queue book' });
    expect(queue).toBeDisabled();
    expect(queue).toHaveAttribute('title', 'Fix the problems below first');
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Nothing starts from a draft. Queue it when the list is right.')).toBeInTheDocument();
  });

  it('shows the actions for each phase', async () => {
    const fetchMock = stubFetch();
    const { rerender } = render(<BookHeader book={book({ phase: 'queued', queuePosition: 2 })} activeBookName="Hardening" flywheelRunning />);
    expect(screen.getByText('Queued · #2')).toBeInTheDocument();
    expect(screen.getByText(/Waits behind "Hardening"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move back to draft' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody(fetchMock)).toEqual({ status: 'draft' });

    rerender(<BookHeader book={book({ phase: 'queued', queuePosition: 2, finished: true })} flywheelRunning />);
    expect(screen.getByText('Finished')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(lastBody(fetchMock)).toEqual({ status: 'complete' }));

    rerender(<BookHeader book={book({ status: 'complete', phase: 'archived', queuePosition: null })} flywheelRunning />);
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add issues' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));
    await waitFor(() => expect(lastBody(fetchMock)).toEqual({ status: 'draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'Book actions' });
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Copy book ID for the CLI' })).toBeInTheDocument();
  });

  it('reports a refused change through onError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Order book book-1 cannot be restored: PAN-1 already belongs to order book b2' }, { status: 409 })));
    const onError = vi.fn();
    render(<BookHeader book={book({ status: 'complete', phase: 'archived', queuePosition: null })} flywheelRunning onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Order book book-1 cannot be restored: PAN-1 already belongs to order book b2'));
  });

  it('renames a book inline', async () => {
    const fetchMock = stubFetch();
    render(<BookHeader book={book()} flywheelRunning onBookChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Workflow redesign' }));
    fireEvent.change(screen.getByLabelText('Book name'), { target: { value: 'Ignored' } });
    fireEvent.keyDown(screen.getByLabelText('Book name'), { key: 'Escape' });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Workflow redesign' }));
    fireEvent.change(screen.getByLabelText('Book name'), { target: { value: 'Workflow redesign, part 2' } });
    fireEvent.keyDown(screen.getByLabelText('Book name'), { key: 'Enter' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastBody(fetchMock)).toEqual({ name: 'Workflow redesign, part 2' });
  });

  it('pauses pickup with a reason and resumes it', async () => {
    const fetchMock = stubFetch();
    render(<BookHeader book={book()} flywheelRunning />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause pickup' }));
    const block = screen.getByLabelText('Pause pickup');
    expect(within(block).getByText('Work already running will finish. Nothing new starts from this book until you resume.')).toBeInTheDocument();
    expect(within(block).getByLabelText('Reason')).toHaveValue('Operator paused new pickup.');
    fireEvent.change(within(block).getByLabelText('Reason'), { target: { value: 'release freeze' } });
    fireEvent.click(within(block).getByRole('button', { name: 'Pause pickup' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastBody(fetchMock)).toEqual({ settings: { posture: 'drain', postureReason: 'release freeze' } });
  });

  it('shows Start Flywheel only when the Flywheel is stopped', async () => {
    const fetchMock = stubFetch({ ok: true, runId: 'conv-1', warnings: [] });
    const onStarted = vi.fn();
    const { rerender } = render(<BookHeader book={book()} flywheelRunning={false} onStarted={onStarted} />);
    expect(screen.getByText('This book is next, but the Flywheel is stopped.')).toBeInTheDocument();
    for (const name of ['Pause pickup', 'Move back to draft', '+ Add issues']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Start Flywheel' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('conv-1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/book-1/start', expect.objectContaining({ method: 'POST' }));

    rerender(<BookHeader book={book()} flywheelRunning />);
    expect(screen.queryByRole('button', { name: 'Start Flywheel' })).toBeNull();
    expect(screen.getByText(/The Flywheel works from this book\. Its issues are cleared to start, and/)).toBeInTheDocument();
    expect(screen.getByText('pan start')).toHaveClass('font-mono');

    rerender(<BookHeader book={book({ settings: { laneAConcurrency: 2, posture: 'drain' } })} flywheelRunning />);
    expect(screen.getByText('Active · pickup paused')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause pickup' })).toBeNull();
  });
});
