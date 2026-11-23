import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OrderBookItem } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../../lib/store';
import type { DerivedIssueState, Issue } from '../../../types';
import { BookIssueList } from '../BookIssueList';
import type { OrderBookProgressItemView, OrderBookView } from '../types';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const at = '2026-11-22T12:00:00.000Z';

function issue(identifier: string, title: string): Issue {
  return {
    id: identifier, identifier, title, status: 'Open', stateType: 'unstarted', priority: 2, labels: [],
    url: `https://example.test/${identifier}`, createdAt: at, updatedAt: at,
  };
}

function item(issueId: string, lane: 'A' | 'B', order: number, overrides: Partial<OrderBookItem> = {}): OrderBookItem {
  return { issue: issueId, lane, order, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator', ...overrides };
}

const landedIds = ['PAN-11', 'PAN-12', 'PAN-13', 'PAN-14', 'PAN-15'];
const longTitle = 'Workflow redesign E: ship step shows merge readiness in one line, even when the title is long';

function book(): OrderBookView {
  const items = [
    item('PAN-1', 'A', 1),
    item('PAN-2', 'A', 2, { prereqs: ['PAN-1'] }),
    ...landedIds.map((id, index) => item(id, 'A', index + 3)),
    item('PAN-3', 'B', 1),
  ];
  const progress: OrderBookProgressItemView[] = items.map((entry) => {
    const closed = landedIds.includes(entry.issue);
    return { issue: entry.issue, closed, parked: false, terminal: closed };
  });
  return {
    id: 'book-1', name: 'Book', status: 'ready', phase: 'active', queuePosition: 1, finished: false,
    settings: { laneAConcurrency: 2, posture: 'open' }, items, createdAt: at, updatedAt: at,
    progress: { total: items.length, landed: 5, drained: false, items: progress },
    prerequisiteTerminal: { 'PAN-1': false },
  };
}

function seedStore() {
  useDashboardStore.setState({
    issuesRaw: [issue('PAN-1', longTitle), issue('PAN-2', 'Second issue'), issue('PAN-3', 'Serial issue')],
    derivedIssueStateByIssueId: { 'PAN-1': { issueId: 'PAN-1', state: 'working' } as DerivedIssueState },
  } as never);
}

function okFetch() {
  const fetchMock = vi.fn(async () => Response.json(book()));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(seedStore);

describe('BookIssueList', () => {
  it('shows the full title and one status tag per row', () => {
    render(<BookIssueList book={book()} flywheelRunning />);
    const row = document.querySelector('[data-issue="PAN-1"]') as HTMLElement;
    expect(within(row).getByTitle(longTitle)).toHaveTextContent(longTitle);
    expect(within(row).getByText('Working')).toHaveClass('text-info-foreground');
    expect(within(document.querySelector('[data-issue="PAN-2"]') as HTMLElement).getByText('Waiting for PAN-1')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('· book');
    expect(document.body).not.toHaveTextContent('PRD ✓');
  });

  it('collapses landed rows behind Show n landed', () => {
    render(<BookIssueList book={book()} />);
    expect(document.querySelector('[data-issue="PAN-11"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '▸ Show 5 landed' }));
    expect(document.querySelectorAll('[data-status="landed"]')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '▾ Hide 5 landed' })).toBeInTheDocument();
  });

  it('moves an issue to the other lane', async () => {
    const fetchMock = okFetch();
    const onBookChange = vi.fn();
    render(<BookIssueList book={book()} project="overdeck" onBookChange={onBookChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run one at a time: PAN-2' }));
    await waitFor(() => expect(onBookChange).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/book-1/items/PAN-2?project=overdeck', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ lane: 'B', order: 2 }),
    }));
  });

  it('saves options for an issue', async () => {
    const fetchMock = okFetch();
    render(<BookIssueList book={book()} onBookChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Options: PAN-3' }));
    const options = screen.getByLabelText('Options for PAN-3');
    fireEvent.change(within(options).getByLabelText(/Start only after these issues land/), { target: { value: 'pan-1, PAN-2' } });
    fireEvent.click(within(options).getByLabelText('Re-check the PRD against main before starting'));
    fireEvent.click(within(options).getByLabelText('Write the plan when it starts'));
    fireEvent.click(within(options).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByLabelText('Options for PAN-3')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/book-1/items/PAN-3', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ prereqs: ['PAN-1', 'PAN-2'], reVerify: true, planAtPickup: true }),
    }));
  });

  it('removes an issue', async () => {
    const fetchMock = okFetch();
    const onBookChange = vi.fn();
    render(<BookIssueList book={book()} onBookChange={onBookChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove: PAN-3' }));
    await waitFor(() => expect(onBookChange).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/book-1/items/PAN-3', expect.objectContaining({ method: 'DELETE' }));
  });

  it('adds an issue dropped from the Add issues panel to that lane', async () => {
    const fetchMock = okFetch();
    render(<BookIssueList book={book()} onBookChange={vi.fn()} />);
    fireEvent.drop(screen.getByRole('region', { name: 'One-at-a-time lane' }), {
      dataTransfer: { types: ['application/x-overdeck-order-issue'], getData: () => 'pan-77' },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/book-1/items', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ item: { issue: 'PAN-77', lane: 'B' } }),
    }));
  });

  it('debounces the parallel limit save', async () => {
    vi.useFakeTimers();
    const fetchMock = okFetch();
    render(<BookIssueList book={book()} onBookChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More parallel issues' }));
    fireEvent.click(screen.getByRole('button', { name: 'More parallel issues' }));
    expect(screen.getByTestId('parallel-limit')).toHaveTextContent('4');
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/book-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ settings: { laneAConcurrency: 4 } }),
    }));
  });

  it('readOnly renders no actions and no stepper buttons', () => {
    render(<BookIssueList book={book()} readOnly />);
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Options/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /parallel issues/ })).toBeNull();
    expect(document.querySelector('[draggable="true"]')).toBeNull();
    expect(document.body).not.toHaveTextContent('· book');
  });
});
