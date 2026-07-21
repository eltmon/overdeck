import type { OrderBook } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import { activeOrderBookIssues } from '../../../../src/lib/cloister/flywheel.js';

const at = '2026-07-18T12:00:00.000Z';

function book(id: string, status: OrderBook['status'], issues: string[]): OrderBook {
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

describe('activeOrderBookIssues', () => {
  it('returns only the book named by the active run when other draft and ready books exist', async () => {
    const books = new Map([
      ['running', book('running', 'running', ['PAN-20'])],
      ['draft', book('draft', 'draft', ['PAN-10'])],
      ['ready', book('ready', 'ready', ['PAN-30'])],
    ]);
    const getBook = vi.fn((_root: string, id: string) => books.get(id) ?? null);

    await expect(activeOrderBookIssues('/project', undefined, {
      activeRunId: () => 'RUN-7',
      readLaunch: async () => ({
        version: 1,
        runId: 'RUN-7',
        workspace: '/project',
        briefPath: '/project/docs/flywheel-brief.md',
        briefDisplayPath: 'docs/flywheel-brief.md',
        orders: { bookId: 'running' },
      }),
      stateRoot: () => '/state',
      getBook,
    })).resolves.toEqual(new Set(['PAN-20']));
    expect(getBook).toHaveBeenCalledOnce();
    expect(getBook).toHaveBeenCalledWith('/state', 'running');
  });

  it('returns no released membership for a bookless run even when books exist', async () => {
    const getBook = vi.fn(() => book('ready', 'ready', ['PAN-30']));

    await expect(activeOrderBookIssues('/project', undefined, {
      activeRunId: () => 'RUN-8',
      readLaunch: async () => ({
        version: 1,
        runId: 'RUN-8',
        workspace: '/project',
        briefPath: '/project/docs/flywheel-brief.md',
        briefDisplayPath: 'docs/flywheel-brief.md',
      }),
      stateRoot: () => '/state',
      getBook,
    })).resolves.toEqual(new Set());
    expect(getBook).not.toHaveBeenCalled();
  });
});
