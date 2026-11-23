/**
 * Derived order-book phase (PAN-5597 WI-1): which book is active, where the
 * others sit in the queue, and whether a book is finished.
 */
import type { OrderBook } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import * as flywheel from '../../../../src/lib/cloister/flywheel.js';
import { deriveBookPhases, isBookFinished } from '../../../../src/lib/orders/phase.js';

const at = '2026-11-22T12:00:00.000Z';

function book(id: string, status: OrderBook['status'], issues: string[] = ['PAN-1']): OrderBook {
  return {
    id,
    name: id,
    status,
    settings: { laneAConcurrency: 1, posture: 'open' },
    items: issues.map((issue, index) => ({
      issue,
      lane: 'A' as const,
      order: index + 1,
      prereqs: [],
      reVerify: false,
      addedAt: at,
      addedBy: 'operator',
    })),
    createdAt: at,
    updatedAt: at,
  };
}

const notDrained = (b: OrderBook) => ({ total: b.items.length, drained: false });

describe('deriveBookPhases', () => {
  it('marks the first ready book active and later ready books queued with positions 2 and 3', () => {
    const views = deriveBookPhases(
      [book('a', 'ready'), book('b', 'ready'), book('d', 'draft'), book('c', 'ready')],
      notDrained,
    );
    expect(views.get('a')).toEqual({ phase: 'active', queuePosition: 1, finished: false });
    expect(views.get('b')).toEqual({ phase: 'queued', queuePosition: 2, finished: false });
    expect(views.get('d')).toEqual({ phase: 'draft', queuePosition: null, finished: false });
    expect(views.get('c')).toEqual({ phase: 'queued', queuePosition: 3, finished: false });
  });

  it('a running book is active ahead of an earlier ready book', () => {
    const views = deriveBookPhases([book('ready', 'ready'), book('running', 'running')], notDrained);
    expect(views.get('running')).toMatchObject({ phase: 'active', queuePosition: 1 });
    expect(views.get('ready')).toMatchObject({ phase: 'queued', queuePosition: 2 });
  });

  it('draft and complete books have no queue position', () => {
    const views = deriveBookPhases([book('d', 'draft'), book('x', 'complete'), book('r', 'ready')], notDrained);
    expect(views.get('d')).toMatchObject({ phase: 'draft', queuePosition: null });
    expect(views.get('x')).toMatchObject({ phase: 'archived', queuePosition: null });
    expect(views.get('r')).toMatchObject({ phase: 'active', queuePosition: 1 });
  });

  it('an empty book is never finished', () => {
    const views = deriveBookPhases([book('empty', 'ready', [])], () => ({ total: 0, drained: true }));
    expect(views.get('empty')?.finished).toBe(false);
  });

  it('a drained non-empty book is finished in any phase', () => {
    const views = deriveBookPhases(
      [book('r', 'ready'), book('q', 'ready'), book('d', 'draft'), book('x', 'complete')],
      b => ({ total: b.items.length, drained: true }),
    );
    for (const id of ['r', 'q', 'd', 'x']) expect(views.get(id)?.finished).toBe(true);
    expect(views.get('x')?.phase).toBe('archived');
  });
});

describe('currentOrderBook home', () => {
  it('lives in src/lib/orders/phase.ts and is no longer exported by the cloister flywheel module', () => {
    expect('currentOrderBook' in flywheel).toBe(false);
  });
});

describe('isBookFinished', () => {
  it('is false for an empty book and true for a drained non-empty book', () => {
    expect(isBookFinished({ total: 0, drained: true })).toBe(false);
    expect(isBookFinished({ total: 2, drained: true })).toBe(true);
    expect(isBookFinished({ total: 2, drained: false })).toBe(false);
  });
});

describe('deriveBookPhases finished rule', () => {
  it('skips a finished ready book and makes the next ready book active', () => {
    const views = deriveBookPhases(
      [book('a', 'ready'), book('b', 'ready')],
      b => ({ total: b.items.length, drained: b.id === 'a' }),
    );
    expect(views.get('b')).toEqual({ phase: 'active', queuePosition: 1, finished: false });
    expect(views.get('a')).toEqual({ phase: 'queued', queuePosition: null, finished: true });
  });

  it('a finished queued book has phase queued, finished true and no queue position', () => {
    const views = deriveBookPhases(
      [book('running', 'running'), book('finished', 'ready')],
      b => ({ total: b.items.length, drained: b.id === 'finished' }),
    );
    expect(views.get('finished')).toEqual({ phase: 'queued', queuePosition: null, finished: true });
  });

  it('numbers the active book 1 and the unfinished queued books after it', () => {
    const views = deriveBookPhases(
      [book('a', 'ready'), book('b', 'ready'), book('c', 'ready')],
      b => ({ total: b.items.length, drained: b.id === 'a' }),
    );
    expect(views.get('b')).toMatchObject({ phase: 'active', queuePosition: 1 });
    expect(views.get('c')).toMatchObject({ phase: 'queued', queuePosition: 2 });
    expect(views.get('a')).toMatchObject({ phase: 'queued', queuePosition: null });
  });

  it('returns no active book when every ready book is finished', () => {
    const views = deriveBookPhases([book('a', 'ready'), book('b', 'ready')], () => ({ total: 1, drained: true }));
    expect(views.get('a')).toEqual({ phase: 'queued', queuePosition: null, finished: true });
    expect(views.get('b')).toEqual({ phase: 'queued', queuePosition: null, finished: true });
    expect([...views.values()].some(view => view.phase === 'active')).toBe(false);
  });
});
