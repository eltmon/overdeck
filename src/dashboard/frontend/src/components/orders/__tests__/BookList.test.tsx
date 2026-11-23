import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookList } from '../BookList';
import type { OrderBookView } from '../types';

const at = '2026-11-22T12:00:00.000Z';

function book(id: string, overrides: Partial<OrderBookView> = {}, issueCount = 2): OrderBookView {
  const items = Array.from({ length: issueCount }, (_, index) => ({
    issue: `PAN-${id.length * 100 + index}`, lane: 'A' as const, order: index + 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator',
  }));
  return {
    id, name: `Book ${id}`, status: 'ready', phase: 'queued', queuePosition: 2, finished: false,
    settings: { laneAConcurrency: 2, posture: 'open' }, items, createdAt: at, updatedAt: at,
    progress: { total: items.length, landed: 0, drained: false },
    ...overrides,
  };
}

function renderList(books: OrderBookView[]) {
  return render(<BookList books={books} selectedId={null} onSelect={vi.fn()} onCreate={vi.fn(async () => {})} creating={false} onCreatingChange={vi.fn()} />);
}

describe('BookList', () => {
  it('groups books under Active, Queued, Drafts and a collapsed Archived', () => {
    renderList([
      book('draft', { status: 'draft', phase: 'draft', queuePosition: null }),
      book('active', { phase: 'active', queuePosition: 1 }),
      book('queued'),
      book('old', { status: 'complete', phase: 'archived', queuePosition: null }),
    ]);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Active', 'Queued', 'Drafts', '▸ Archived (1)']);
    expect(screen.queryByText('Book old')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '▸ Archived (1)' }));
    expect(screen.getByText('Book old')).toBeInTheDocument();
  });

  it('shows No book is queued when no book is active', () => {
    renderList([book('draft', { status: 'draft', phase: 'draft', queuePosition: null })]);
    expect(screen.getByText('No book is queued, so the Flywheel follows the backlog.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Queued' })).toBeNull();
  });

  it('lists a finished queued book after the numbered queued books without a position', () => {
    renderList([
      book('active', { phase: 'active', queuePosition: 1 }),
      book('second', { queuePosition: 2 }),
      book('done', { queuePosition: null, finished: true }),
      book('third', { queuePosition: 3 }),
    ]);
    const order = [...document.querySelectorAll('[data-book]')].map((el) => el.getAttribute('data-book'));
    expect(order).toEqual(['active', 'second', 'third', 'done']);
    const row = (id: string) => within(document.querySelector(`[data-book="${id}"]`) as HTMLElement);
    expect(row('done').queryByText(/^#\d+$/)).toBeNull();
  });

  it('says every queued book has finished when no book is active but finished books are queued', () => {
    renderList([
      book('done', { queuePosition: null, finished: true }),
    ]);
    expect(screen.getByText('Every queued book has finished, so the Flywheel follows the backlog.')).toBeInTheDocument();
    expect(screen.queryByText('No book is queued, so the Flywheel follows the backlog.')).toBeNull();
  });

  it('shows the meta line for each phase', () => {
    renderList([
      book('active', { phase: 'active', queuePosition: 1, settings: { laneAConcurrency: 2, posture: 'drain' }, progress: { total: 4, landed: 1, drained: false } }, 4),
      book('queued', { queuePosition: 2 }, 4),
      book('done', { queuePosition: 3, finished: true, progress: { total: 3, landed: 3, drained: true } }, 3),
      book('draft', { status: 'draft', phase: 'draft', queuePosition: null, validation: { blocks: [{ code: 'x', issue: 'PAN-1', message: 'm' }, { code: 'y', issue: 'PAN-2', message: 'm' }], warns: [] } }, 1),
    ]);
    const row = (id: string) => within(document.querySelector(`[data-book="${id}"]`) as HTMLElement);
    expect(row('active').getByText('1 of 4 landed · paused')).toBeInTheDocument();
    expect(row('queued').getByText('Queued · 4 issues')).toBeInTheDocument();
    expect(row('queued').getByText('#2')).toBeInTheDocument();
    expect(row('done').getByText('Finished · all 3 landed')).toBeInTheDocument();
    expect(row('draft').getByText('Draft · 1 issue · 2 to fix')).toBeInTheDocument();
  });
});
