import type { OrderBookItem } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import type { DerivedIssueState } from '../../../types';
import { itemStatus, orderBookContext } from '../itemStatus';
import type { OrderBookProgressItemView, OrderBookView } from '../types';

const at = '2026-11-22T12:00:00.000Z';

function item(issue: string, overrides: Partial<OrderBookItem> = {}): OrderBookItem {
  return { issue, lane: 'A', order: 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator', ...overrides };
}

function book(items: OrderBookItem[], overrides: Partial<OrderBookView> = {}, progress: OrderBookProgressItemView[] = []): OrderBookView {
  return {
    id: 'book',
    name: 'Book',
    status: 'ready',
    phase: 'active',
    queuePosition: 1,
    finished: false,
    settings: { laneAConcurrency: 2, posture: 'open' },
    items,
    createdAt: at,
    updatedAt: at,
    progress: { total: items.length, landed: 0, drained: false, items: progress },
    ...overrides,
  };
}

function derived(entries: Array<[string, DerivedIssueState['state']]>): Record<string, DerivedIssueState> {
  return Object.fromEntries(entries.map(([issueId, state]) => [issueId, { issueId, state } as DerivedIssueState]));
}

function statusOf(value: OrderBookView, issue: string, states: Array<[string, DerivedIssueState['state']]> = [], flywheelRunning = true) {
  const context = orderBookContext(value, derived(states), flywheelRunning);
  return itemStatus(context, value.items.find((candidate) => candidate.issue === issue)!);
}

const open = (issue: string): OrderBookProgressItemView => ({ issue, closed: false, parked: false, terminal: false });

describe('itemStatus', () => {
  it('Landed', () => {
    const value = book([item('PAN-1')], {}, [{ issue: 'PAN-1', closed: true, parked: false, terminal: true }]);
    expect(statusOf(value, 'PAN-1')).toEqual({ kind: 'landed', label: 'Landed', tone: 'success' });
    expect(statusOf(book([item('PAN-2')]), 'PAN-2', [['PAN-2', 'merged']])).toMatchObject({ label: 'Landed', tone: 'success' });
  });

  it('Parked', () => {
    const value = book([item('PAN-1')], {}, [{ issue: 'PAN-1', closed: false, parked: true, terminal: true }]);
    expect(statusOf(value, 'PAN-1')).toEqual({ kind: 'parked', label: 'Parked', tone: 'neutral' });
  });

  it('In review', () => {
    for (const state of ['in-review', 'changes-requested', 'ready'] as const) {
      expect(statusOf(book([item('PAN-1')]), 'PAN-1', [['PAN-1', state]])).toEqual({ kind: 'review', label: 'In review', tone: 'warning' });
    }
  });

  it('Working', () => {
    expect(statusOf(book([item('PAN-1')]), 'PAN-1', [['PAN-1', 'working']])).toEqual({ kind: 'working', label: 'Working', tone: 'info' });
  });

  it('Not queued yet', () => {
    expect(statusOf(book([item('PAN-1')], { status: 'draft', phase: 'draft', queuePosition: null }), 'PAN-1').label).toBe('Not queued yet');
  });

  it('Book is not active yet', () => {
    expect(statusOf(book([item('PAN-1')], { phase: 'queued', queuePosition: 2 }), 'PAN-1').label).toBe('Book is not active yet');
  });

  it('Not started', () => {
    expect(statusOf(book([item('PAN-1')], { status: 'complete', phase: 'archived', queuePosition: null }), 'PAN-1').label).toBe('Not started');
  });

  it('Pickup paused', () => {
    const value = book([item('PAN-1')], { settings: { laneAConcurrency: 2, posture: 'drain' } });
    expect(statusOf(value, 'PAN-1').label).toBe('Pickup paused');
  });

  it('Waiting for <ids>', () => {
    const value = book([item('PAN-1', { prereqs: ['pan-9', 'PAN-8'] })], { prerequisiteTerminal: { 'PAN-9': false, 'PAN-8': true } });
    expect(statusOf(value, 'PAN-1')).toEqual({ kind: 'waiting', label: 'Waiting for PAN-9', tone: 'neutral' });
  });

  it('PRD needs a re-check first', () => {
    expect(statusOf(book([item('PAN-1', { reVerify: true })]), 'PAN-1').label).toBe('PRD needs a re-check first');
  });

  it('Waiting its turn', () => {
    const value = book([item('PAN-1', { lane: 'B', order: 1 }), item('PAN-2', { lane: 'B', order: 2 })], {}, [open('PAN-1'), open('PAN-2')]);
    expect(statusOf(value, 'PAN-2', [['PAN-1', 'working']]).label).toBe('Waiting its turn');
  });

  it('Waiting for a free slot (2 of 2 running)', () => {
    const value = book([item('PAN-1'), item('PAN-2', { order: 2 }), item('PAN-3', { order: 3 })], {}, [open('PAN-1'), open('PAN-2'), open('PAN-3')]);
    expect(statusOf(value, 'PAN-3', [['PAN-1', 'working'], ['PAN-2', 'in-review']]).label)
      .toBe('Waiting for a free slot (2 of 2 running)');
  });

  it('Starts next', () => {
    expect(statusOf(book([item('PAN-1')]), 'PAN-1', [], true)).toEqual({ kind: 'ready', label: 'Starts next', tone: 'neutral' });
  });

  it('Ready, Flywheel is stopped', () => {
    expect(statusOf(book([item('PAN-1')]), 'PAN-1', [], false).label).toBe('Ready, Flywheel is stopped');
  });
});
