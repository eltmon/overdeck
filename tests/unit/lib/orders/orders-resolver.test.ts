import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrderBook } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backlogCandidates,
  computeBookProgress,
  membership,
  ensureOrderIssueStore,
  orderIssueStoreStatus,
} from '../../../../src/lib/orders/resolver.js';
import {
  getSharedIssueService,
  isSharedIssueServiceStarted,
  startSharedIssueService,
} from '../../../../src/dashboard/server/services/issue-service-singleton.js';

vi.mock('../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: vi.fn(),
  startSharedIssueService: vi.fn(),
  isSharedIssueServiceStarted: vi.fn(),
}));

const roots: string[] = [];
const at = '2026-07-17T12:00:00.000Z';

function fixtureRoot(): string {
  const root = join(process.cwd(), `.test-orders-resolver-${process.pid}-${roots.length}`);
  roots.push(root);
  mkdirSync(join(root, 'orders'), { recursive: true });
  return root;
}

function book(id: string, status: OrderBook['status'], issues: string[]): OrderBook {
  return {
    id,
    name: id,
    status,
    settings: { laneAConcurrency: 2, posture: 'open' },
    items: issues.map((issue, index) => ({
      issue,
      lane: index % 2 === 0 ? 'A' : 'B',
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

function writeBooks(root: string, books: OrderBook[]): void {
  for (const value of books) {
    writeFileSync(join(root, 'orders', `${value.id}.json`), JSON.stringify(value), 'utf8');
  }
  writeFileSync(
    join(root, 'orders', 'index.json'),
    JSON.stringify(books.map(({ id, name, status, runId, updatedAt }) => ({ id, name, status, runId, updatedAt }))),
    'utf8',
  );
}

function writeSequence(root: string): void {
  mkdirSync(join(root, 'backlog'), { recursive: true });
  const nodes = ['PAN-1', 'PAN-2', 'PAN-3', 'PAN-4'].map((issue, index) => ({
    issue,
    rank: index + 1,
    size: 'S',
    importance: 'medium',
    score: 50,
    condition: 'ok',
    dependsOn: [],
    why: issue,
    gate: 'auto',
    planning: 'auto',
  }));
  const doc = {
    version: 1,
    project: 'overdeck',
    generatedAt: at,
    model: 'test',
    pass: 'creation',
    openCount: nodes.length,
    nodes,
    edges: [],
  };
  writeFileSync(join(root, 'backlog', 'sequence.md'), `# Backlog\n\n\`\`\`json\n${JSON.stringify(doc)}\n\`\`\`\n`, 'utf8');
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('orders resolver', () => {
  it('excludes non-complete membership from backlog candidates without changing rank', () => {
    const root = fixtureRoot();
    writeBooks(root, [
      book('2026-07-17-active', 'ready', ['PAN-2']),
      book('2026-07-17-complete', 'complete', ['PAN-3']),
    ]);
    writeSequence(root);

    expect([...membership(root)]).toEqual([['PAN-2', '2026-07-17-active']]);
    expect(backlogCandidates(root, 10).map(({ issue, rank }) => ({ issue, rank }))).toEqual([
      { issue: 'PAN-1', rank: 1 },
      { issue: 'PAN-3', rank: 3 },
      { issue: 'PAN-4', rank: 4 },
    ]);
  });

  it('drains exactly when every item is closed or parked', () => {
    const value = book('2026-07-17-progress', 'running', ['PAN-1', 'PAN-2']);
    const lookup = (parkSecond: boolean) => () => new Map([
      ['PAN-1', { issue: 'PAN-1', open: false, parked: false }],
      ['PAN-2', { issue: 'PAN-2', open: true, parked: parkSecond }],
    ]);

    expect(computeBookProgress(value, lookup(false)).drained).toBe(false);
    const progress = computeBookProgress(value, lookup(true));
    expect(progress.drained).toBe(true);
    expect(progress.landed).toBe(1);
  });

  describe('ensureOrderIssueStore', () => {
    it('starts the shared issue service without polling', async () => {
      await ensureOrderIssueStore();

      expect(startSharedIssueService).toHaveBeenCalledWith({ skipPolling: true });
    });
  });

  describe('orderIssueStoreStatus', () => {
    it('reports the shared service start state and issue count', async () => {
      await ensureOrderIssueStore();
      vi.mocked(isSharedIssueServiceStarted).mockReturnValue(true);
      vi.mocked(getSharedIssueService).mockReturnValue({
        getIssues: vi.fn(() => [{ identifier: 'PAN-1' }, { identifier: 'PAN-2' }]),
      } as never);

      expect(orderIssueStoreStatus()).toEqual({ started: true, issueCount: 2 });
    });

    it('falls back to unavailable when the shared service throws', async () => {
      await ensureOrderIssueStore();
      vi.mocked(isSharedIssueServiceStarted).mockImplementation(() => {
        throw new Error('service unavailable');
      });

      expect(orderIssueStoreStatus()).toEqual({ started: false, issueCount: 0 });
    });
  });
});
