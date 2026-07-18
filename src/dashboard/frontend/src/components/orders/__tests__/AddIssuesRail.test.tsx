import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../../../types';
import type { OrderBookView } from '../BookStrip';
import { AddIssuesRail } from '../AddIssuesRail';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

function issue(identifier: string, title: string, labels: string[] = [], stateType = 'unstarted'): Issue {
  return {
    id: identifier,
    identifier,
    title,
    status: stateType === 'completed' ? 'Completed' : 'Open',
    stateType,
    priority: 2,
    labels,
    url: `https://example.test/${identifier}`,
    createdAt: '2026-07-18T12:00:00.000Z',
    updatedAt: '2026-07-18T12:00:00.000Z',
  };
}

function book(id: string, name: string, issues: string[] = []): OrderBookView {
  return {
    id, name, status: 'ready', settings: { laneAConcurrency: 2, posture: 'open' },
    items: issues.map((value, index) => ({ issue: value, lane: 'A', order: index + 1, prereqs: [], reVerify: false, addedAt: '2026-07-18T12:00:00.000Z', addedBy: 'operator' })),
    createdAt: '2026-07-18T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z',
    progress: { total: issues.length, landed: 0, drained: false },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('AddIssuesRail', () => {
  it('filters open issues by id, title, and label and adds without dispatching', async () => {
    const current = book('2026-07-18-current', 'Current', ['PAN-3']);
    const other = book('2026-07-18-other', 'Other campaign', ['PAN-4']);
    const issues = [
      issue('PAN-1', 'Alpha substrate fix', ['substrate']),
      issue('PAN-2', 'Closed work', [], 'completed'),
      issue('PAN-3', 'Already current'),
      issue('PAN-4', 'Owned elsewhere'),
    ];
    const fetchMock = vi.fn(async () => Response.json(current));
    vi.stubGlobal('fetch', fetchMock);
    const onBookChange = vi.fn();
    render(<AddIssuesRail book={current} books={[current, other]} issues={issues} onBookChange={onBookChange} />);

    fireEvent.change(screen.getByPlaceholderText('ID, title, or label'), { target: { value: 'substrate' } });
    expect(screen.getByText('PAN-1')).toBeInTheDocument();
    expect(screen.queryByText('PAN-2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Lane A' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/2026-07-18-current/items',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ item: { issue: 'PAN-1', lane: 'A' } }) }),
    ));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/start'))).toBe(false);
    expect(onBookChange).toHaveBeenCalledWith(current);
  });

  it('disables membership owned by the current or another non-complete book', () => {
    const current = book('2026-07-18-current', 'Current', ['PAN-3']);
    const other = book('2026-07-18-other', 'Other campaign', ['PAN-4']);
    render(<AddIssuesRail book={current} books={[current, other]} issues={[issue('PAN-3', 'Current'), issue('PAN-4', 'Other')]} onBookChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('ID, title, or label'), { target: { value: 'PAN-' } });
    const currentRow = screen.getByText('PAN-3').closest('div');
    const otherRow = screen.getByText('PAN-4').closest('div');
    expect(within(currentRow!).getByRole('button', { name: 'Already in this book' })).toBeDisabled();
    expect(within(otherRow!).getByRole('button', { name: 'In Other campaign' })).toBeDisabled();
  });
});
