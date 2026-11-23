import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../../lib/store';
import type { Issue } from '../../../types';
import { AddIssuesPanel } from '../AddIssuesPanel';
import type { OrderBookView } from '../types';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const at = '2026-11-22T12:00:00.000Z';

function issue(identifier: string, title: string, labels: string[] = [], stateType = 'unstarted'): Issue {
  return { id: identifier, identifier, title, status: 'Open', stateType, priority: 2, labels, url: `https://example.test/${identifier}`, createdAt: at, updatedAt: at } as Issue;
}

function book(id: string, name: string, issues: string[], phase: OrderBookView['phase'] = 'draft'): OrderBookView {
  return {
    id, name, status: phase === 'archived' ? 'complete' : phase === 'draft' ? 'draft' : 'ready', phase, queuePosition: null, finished: false,
    settings: { laneAConcurrency: 2, posture: 'open' },
    items: issues.map((value, index) => ({ issue: value, lane: 'A', order: index + 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' })),
    createdAt: at, updatedAt: at, progress: { total: issues.length, landed: 0, drained: false },
  };
}

function renderPanel(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

const current = book('current', 'Current', ['PAN-3']);
const other = book('other', 'Other campaign', ['PAN-4'], 'queued');
const archived = book('old', 'Old', ['PAN-5'], 'archived');

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('backlog-candidates')) {
      return Response.json({ candidates: [
        { issue: 'PAN-7', rank: 2, why: 'second in sequence' },
        { issue: 'PAN-6', rank: 1, why: 'first in sequence' },
      ] });
    }
    return Response.json(current);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  useDashboardStore.setState({
    issuesRaw: [
      issue('PAN-3', 'Already here', ['frontend']),
      issue('PAN-4', 'Owned elsewhere', ['frontend']),
      issue('PAN-5', 'Archived member', ['frontend']),
      issue('PAN-6', 'First backlog issue'),
      issue('PAN-8', 'Closed frontend work', ['frontend'], 'completed'),
      issue('PAN-9', 'Backend only', ['backend']),
    ],
  } as never);
});
afterEach(() => vi.unstubAllGlobals());

describe('AddIssuesPanel', () => {
  it('shows backlog candidates by title with their rank when the search is empty', async () => {
    stubFetch();
    renderPanel(<AddIssuesPanel book={current} books={[current, other]} />);
    expect(screen.getByText('Top of your backlog')).toBeInTheDocument();
    const first = await screen.findByText('First backlog issue');
    const row = first.closest('[data-candidate]') as HTMLElement;
    expect(row).toHaveAttribute('data-candidate', 'PAN-6');
    expect(within(row).getByText(/backlog #1/)).toBeInTheDocument();
    expect(row).toHaveAttribute('title', 'first in sequence');
    // No title in the store: the sequencer's why text stands in.
    expect(screen.getByText('second in sequence')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Add PAN-/ })).toHaveLength(2);
    expect(screen.getAllByRole('group', { name: 'Add to' })).toHaveLength(1);
  });

  it('filters open issues by id, title and label', async () => {
    stubFetch();
    renderPanel(<AddIssuesPanel book={current} books={[current, other, archived]} />);
    fireEvent.change(screen.getByLabelText('Search open issues'), { target: { value: 'frontend' } });
    expect(screen.getByText('Open issues')).toBeInTheDocument();
    const ids = [...document.querySelectorAll('[data-candidate]')].map((row) => row.getAttribute('data-candidate'));
    expect(ids).toEqual(['PAN-3', 'PAN-4', 'PAN-5']);
    fireEvent.change(screen.getByLabelText('Search open issues'), { target: { value: 'pan-9' } });
    expect(screen.getByText('Backend only')).toBeInTheDocument();
  });

  it('adds to the lane chosen in Add to', async () => {
    const fetchMock = stubFetch();
    const onBookChange = vi.fn();
    renderPanel(<AddIssuesPanel book={current} books={[current]} project="overdeck" onBookChange={onBookChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'One at a time' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add PAN-6' }));
    await waitFor(() => expect(onBookChange).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/current/items?project=overdeck', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ item: { issue: 'PAN-6', lane: 'B' } }),
    }));
  });

  it('marks issues owned by another book and offers no Add button', () => {
    stubFetch();
    renderPanel(<AddIssuesPanel book={current} books={[current, other, archived]} />);
    fireEvent.change(screen.getByLabelText('Search open issues'), { target: { value: 'frontend' } });
    const row = (id: string) => within(document.querySelector(`[data-candidate="${id}"]`) as HTMLElement);
    expect(row('PAN-4').getByText('In Other campaign')).toBeInTheDocument();
    expect(row('PAN-4').queryByRole('button', { name: /Add/ })).toBeNull();
    expect(row('PAN-3').getByText('In this book')).toBeInTheDocument();
    expect(row('PAN-5').getByRole('button', { name: 'Add PAN-5' })).toBeInTheDocument();
  });
});
