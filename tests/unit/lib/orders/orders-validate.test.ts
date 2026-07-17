import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrderBook } from '@overdeck/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { validateBookForStart } from '../../../../src/lib/orders/validate.js';

const roots: string[] = [];
const at = '2026-07-17T12:00:00.000Z';

function fixtureRoot(): string {
  const root = join(process.cwd(), `.test-orders-validate-${process.pid}-${roots.length}`);
  roots.push(root);
  mkdirSync(join(root, 'orders'), { recursive: true });
  writeFileSync(join(root, 'orders', 'index.json'), '[]', 'utf8');
  return root;
}

function item(issue: string, lane: 'A' | 'B', prereqs: string[] = []) {
  return { issue, lane, order: 1, prereqs, reVerify: false, addedAt: at, addedBy: 'operator' } as const;
}

function book(items: OrderBook['items'], id = '2026-07-17-campaign'): OrderBook {
  return {
    id,
    name: 'Campaign',
    status: 'ready',
    settings: { laneAConcurrency: 2, posture: 'open' },
    items,
    createdAt: at,
    updatedAt: at,
  };
}

function writeOtherBook(root: string, value: OrderBook): void {
  writeFileSync(join(root, 'orders', `${value.id}.json`), JSON.stringify(value), 'utf8');
  writeFileSync(
    join(root, 'orders', 'index.json'),
    JSON.stringify([{ id: value.id, name: value.name, status: value.status, updatedAt: value.updatedAt }]),
    'utf8',
  );
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('order book start validation', () => {
  it('reports closed issues, cross-book duplicates, unresolved prerequisites, cycles, and missing Lane B PRDs', () => {
    const root = fixtureRoot();
    writeOtherBook(root, book([item('PAN-1', 'A')], '2026-07-17-other'));
    const value = book([
      item('PAN-1', 'A'),
      item('PAN-2', 'B', ['PAN-3', 'PAN-404']),
      item('PAN-3', 'A', ['PAN-2']),
    ]);
    const issueLookup = () => new Map([
      ['PAN-1', { issue: 'PAN-1', open: false, parked: false }],
      ['PAN-2', { issue: 'PAN-2', open: true, parked: false }],
      ['PAN-3', { issue: 'PAN-3', open: true, parked: false }],
    ]);

    const result = validateBookForStart(root, value, { issueLookup, hasPrd: () => false });
    expect(result.blocks.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'issue-not-open',
      'duplicate-membership',
      'unresolved-prerequisite',
      'prerequisite-cycle',
      'missing-prd',
    ]));
    expect(result.warns).toEqual([]);
  });

  it('moves only a plan-at-pickup missing-PRD finding to warnings', () => {
    const root = fixtureRoot();
    const value = book([{ ...item('PAN-2', 'B'), planAtPickup: true }]);
    const issueLookup = () => new Map([
      ['PAN-2', { issue: 'PAN-2', open: true, parked: false }],
    ]);

    const result = validateBookForStart(root, value, { issueLookup, hasPrd: () => false });
    expect(result.blocks).toEqual([]);
    expect(result.warns).toMatchObject([{ code: 'missing-prd', issue: 'PAN-2' }]);
  });
});
