/**
 * PAN-3917: the order-book write door persists to `<planHome>/.pan/orders/`.
 * It writes files; the agent or operator that changed them commits — the door
 * itself never commits or pushes.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getBookAsync } from '../../../../src/lib/orders/resolver.js';
import { addItems, assertRestorable, createBook, moveItem, setItemRequirements, setStatus } from '../../../../src/lib/orders/writer.js';

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

    expect(await getBookAsync(root, '2026-07-17-first')).toMatchObject({
      id: '2026-07-17-first',
      status: 'ready',
      items: [
        { issue: 'PAN-1', lane: 'A', order: 1, addedAt: at, addedBy: 'operator' },
        { issue: 'PAN-2', lane: 'B', order: 1, prereqs: ['PAN-3'], reVerify: false, planAtPickup: true, addedAt: at, addedBy: 'operator' },
      ],
    });
    expect((await getBookAsync(root, '2026-07-17-first'))?.runId).toBeUndefined();
    const index = JSON.parse(readFileSync(join(root, 'orders', 'index.json'), 'utf8')) as Array<{ id: string }>;
    expect(index.map((entry) => entry.id)).toEqual(['2026-07-17-first', '2026-07-17-second']);
  });

  it('keeps both of two concurrent mutations on one book', async () => {
    const root = panFixture();
    await createBook(root, { id: '2026-07-17-first', name: 'First', createdAt: at });
    await addItems(root, '2026-07-17-first', [
      { issue: 'PAN-1', lane: 'A', order: 1, prereqs: [], reVerify: false },
      { issue: 'PAN-2', lane: 'A', order: 2, prereqs: [], reVerify: false },
    ], 'operator', at);

    // Fired together, as two dashboard PATCHes would be: each reads the book before writing it.
    await Promise.all([
      setItemRequirements(root, '2026-07-17-first', 'PAN-1', { reVerify: true }, at),
      moveItem(root, '2026-07-17-first', 'PAN-2', 'B', 1, at),
    ]);

    expect((await getBookAsync(root, '2026-07-17-first'))?.items).toMatchObject([
      { issue: 'PAN-1', lane: 'A', order: 1, reVerify: true },
      { issue: 'PAN-2', lane: 'B', order: 1 },
    ]);
  });

  it('lets only one of two concurrent same-id creates through', async () => {
    const root = panFixture();

    const results = await Promise.allSettled([
      createBook(root, { id: '2026-07-17-same', name: 'Winner', createdAt: at }),
      createBook(root, { id: '2026-07-17-same', name: 'Loser', createdAt: at }),
    ]);

    expect(results[0]).toMatchObject({ status: 'fulfilled' });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'Order book already exists: 2026-07-17-same' }),
    });
    expect((await getBookAsync(root, '2026-07-17-same'))?.name).toBe('Winner');
  });

  describe('assertRestorable', () => {
    function snapshot(root: string): Record<string, string> {
      const dir = join(root, 'orders');
      return Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), 'utf8')]));
    }

    async function bookWith(root: string, id: string, issues: string[], status: 'ready' | 'complete') {
      await createBook(root, { id, name: id, createdAt: at });
      await addItems(root, id, issues.map((issue, index) => ({
        issue, lane: 'A' as const, order: index + 1, prereqs: [], reVerify: false,
      })), 'operator', at);
      return setStatus(root, id, status, { at });
    }

    it('refuses a restore when an issue belongs to another live book', async () => {
      const root = panFixture();
      const archived = await bookWith(root, '2026-07-17-old', ['PAN-2', 'pan-1'], 'complete');
      await bookWith(root, '2026-07-17-b', ['PAN-1'], 'ready');
      const before = snapshot(root);
      expect(() => assertRestorable(root, archived)).toThrow(
        'Order book 2026-07-17-old cannot be restored: PAN-1 already belongs to order book 2026-07-17-b',
      );
      expect(snapshot(root)).toEqual(before);
    });

    it('allows a restore when the issues appear only in other archived books', async () => {
      const root = panFixture();
      const archived = await bookWith(root, '2026-07-17-old', ['PAN-1'], 'complete');
      await bookWith(root, '2026-07-17-older', ['PAN-1'], 'complete');
      const before = snapshot(root);
      expect(() => assertRestorable(root, archived)).not.toThrow();
      expect(snapshot(root)).toEqual(before);
    });
  });
});
