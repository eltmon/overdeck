import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getBook } from '../../../../src/lib/orders/resolver.js';
import { addItems, createBook, moveItem, setStatus } from '../../../../src/lib/orders/writer.js';

const roots: string[] = [];
const at = '2026-07-17T12:00:00.000Z';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitFixture(): string {
  const root = join(process.cwd(), `.test-orders-writer-${process.pid}-${roots.length}`);
  const origin = `${root}-origin.git`;
  roots.push(root, origin);
  mkdirSync(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Orders Test'], root);
  git(['config', 'user.email', 'orders@example.com'], root);
  writeFileSync(join(root, 'migration-complete.json'), JSON.stringify({ migratedAt: at, sourceCommitSha: 'abc123' }), 'utf8');
  git(['add', 'migration-complete.json'], root);
  git(['commit', '-m', 'seed'], root);
  git(['branch', '-M', 'overdeck-state'], root);
  execFileSync('git', ['init', '--bare', origin], { encoding: 'utf8' });
  git(['remote', 'add', 'origin', origin], root);
  git(['push', '-u', 'origin', 'overdeck-state'], root);
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('orders writer', () => {
  it('roundtrips mutations, preserves queue order, and commits state writes', async () => {
    const root = gitFixture();
    await createBook(root, { id: '2026-07-17-first', name: 'First', createdAt: at });
    await createBook(root, { id: '2026-07-17-second', name: 'Second', createdAt: at });
    await addItems(root, '2026-07-17-first', [
      { issue: 'PAN-1', lane: 'A', order: 1, prereqs: [], reVerify: false },
      { issue: 'PAN-2', lane: 'A', order: 2, prereqs: ['PAN-1'], reVerify: true },
    ], 'operator', at);
    await moveItem(root, '2026-07-17-first', 'PAN-2', 'B', 1, at);
    await setStatus(root, '2026-07-17-first', 'ready', { at });

    expect(getBook(root, '2026-07-17-first')).toMatchObject({
      id: '2026-07-17-first',
      status: 'ready',
      items: [
        { issue: 'PAN-1', lane: 'A', order: 1, addedAt: at, addedBy: 'operator' },
        { issue: 'PAN-2', lane: 'B', order: 1, addedAt: at, addedBy: 'operator' },
      ],
    });
    const index = JSON.parse(readFileSync(join(root, 'orders', 'index.json'), 'utf8')) as Array<{ id: string }>;
    expect(index.map((entry) => entry.id)).toEqual(['2026-07-17-first', '2026-07-17-second']);
    expect(Number(git(['rev-list', '--count', 'HEAD'], root))).toBeGreaterThan(1);
    expect(git(['status', '--porcelain'], root)).toBe('');
    expect(git(['rev-parse', 'HEAD'], root)).toBe(git(['rev-parse', 'origin/overdeck-state'], root));
  });
});
