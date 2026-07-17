import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  backlogSequencePath,
  orderBookIndexPath,
  orderBookPath,
  readOrderBook,
} from '../../../../src/lib/orders/io.js';

const roots: string[] = [];

function fixtureRoot(): string {
  const root = join(process.cwd(), `.test-orders-io-${process.pid}-${roots.length}`);
  roots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('orders io', () => {
  it('resolves order and backlog paths from the supplied state root', () => {
    const root = fixtureRoot();

    expect(orderBookPath(root, '2026-07-17-campaign')).toBe(join(root, 'orders', '2026-07-17-campaign.json'));
    expect(orderBookIndexPath(root)).toBe(join(root, 'orders', 'index.json'));
    expect(backlogSequencePath(root)).toBe(join(root, 'backlog', 'sequence.md'));
    expect(() => orderBookPath(root, '../escape')).toThrow('Invalid order book id');
  });

  it('returns a descriptive error for malformed order book JSON', () => {
    const root = fixtureRoot();
    const path = orderBookPath(root, '2026-07-17-malformed');
    mkdirSync(join(root, 'orders'), { recursive: true });
    writeFileSync(path, '{bad json', 'utf8');

    expect(() => readOrderBook(root, '2026-07-17-malformed')).toThrow(
      /Could not parse order book 2026-07-17-malformed:.*JSON/,
    );
  });
});
