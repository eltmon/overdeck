/**
 * PAN-3917: the order-book write door persists to `<planHome>/.pan/orders/`.
 * It writes files; the agent or operator that changed them commits — the door
 * itself never commits or pushes.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getBook } from '../../../../src/lib/orders/resolver.js';
import { addItems, createBook, moveItem, setItemRequirements, setStatus } from '../../../../src/lib/orders/writer.js';

const roots: string[] = [];
const at = '2026-07-17T12:00:00.000Z';

/** A plan-home `.pan` directory. */
function panFixture(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'orders-writer-')), '.pan');
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('orders writer', () => {
  it('roundtrips mutations and preserves queue order', async () => {
    const root = panFixture();
    await createBook(root, { id: '2026-07-17-first', name: 'First', createdAt: at });
    await createBook(root, { id: '2026-07-17-second', name: 'Second', createdAt: at });
    await addItems(root, '2026-07-17-first', [
      { issue: 'PAN-1', lane: 'A', order: 1, prereqs: [], reVerify: false },
      { issue: 'PAN-2', lane: 'A', order: 2, prereqs: ['PAN-1'], reVerify: true },
    ], 'operator', at);
    await moveItem(root, '2026-07-17-first', 'PAN-2', 'B', 1, at);
    await setItemRequirements(root, '2026-07-17-first', 'PAN-2', {
      prereqs: ['pan-3', 'PAN-3'],
      reVerify: false,
      planAtPickup: true,
    }, at);
    await setStatus(root, '2026-07-17-first', 'running', { at, runId: 'RUN-1' });
    await setStatus(root, '2026-07-17-first', 'ready', { at, runId: null });

    expect(getBook(root, '2026-07-17-first')).toMatchObject({
      id: '2026-07-17-first',
      status: 'ready',
      items: [
        { issue: 'PAN-1', lane: 'A', order: 1, addedAt: at, addedBy: 'operator' },
        { issue: 'PAN-2', lane: 'B', order: 1, prereqs: ['PAN-3'], reVerify: false, planAtPickup: true, addedAt: at, addedBy: 'operator' },
      ],
    });
    expect(getBook(root, '2026-07-17-first')?.runId).toBeUndefined();
    const index = JSON.parse(readFileSync(join(root, 'orders', 'index.json'), 'utf8')) as Array<{ id: string }>;
    expect(index.map((entry) => entry.id)).toEqual(['2026-07-17-first', '2026-07-17-second']);
  });
});
