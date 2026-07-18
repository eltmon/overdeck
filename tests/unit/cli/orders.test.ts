import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createOrdersCommand,
  formatBook,
  formatBookList,
  runOrdersAdd,
  runOrdersCreate,
  runOrdersList,
  runOrdersMove,
  runOrdersRemove,
  runOrdersShow,
  runOrdersStart,
} from '../../../src/cli/commands/orders.js';
import { addItems, createBook } from '../../../src/lib/orders/writer.js';

const roots: string[] = [];
const at = '2026-07-18T12:00:00.000Z';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitFixture(): string {
  const root = join(process.cwd(), `.test-orders-cli-${process.pid}-${roots.length}`);
  const origin = `${root}-origin.git`;
  roots.push(root, origin);
  mkdirSync(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Orders CLI Test'], root);
  git(['config', 'user.email', 'orders-cli@example.com'], root);
  writeFileSync(join(root, 'migration-complete.json'), JSON.stringify({ seededAt: at }), 'utf8');
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
  vi.restoreAllMocks();
});

describe('pan orders commands', () => {
  it('creates, adds after an anchor, shows, moves, removes, lists, and starts a book', async () => {
    const stateRoot = gitFixture();
    const deps = {
      stateRoot,
      now: () => new Date(at),
      actor: 'operator',
    };
    const created = await runOrdersCreate('Refactor Campaign', deps);
    expect(created.id).toBe('2026-07-18-refactor-campaign');

    await runOrdersAdd(created.id, ['PAN-1'], { lane: 'B' }, deps);
    await runOrdersAdd(created.id, ['PAN-3'], { lane: 'B' }, deps);
    const added = await runOrdersAdd(created.id, ['PAN-2'], {
      lane: 'B',
      after: 'PAN-1',
      reverify: true,
    }, deps);
    expect(added.items.map(({ issue, lane, order, reVerify }) => ({ issue, lane, order, reVerify }))).toEqual([
      { issue: 'PAN-1', lane: 'B', order: 1, reVerify: false },
      { issue: 'PAN-2', lane: 'B', order: 2, reVerify: true },
      { issue: 'PAN-3', lane: 'B', order: 3, reVerify: false },
    ]);

    const shown = runOrdersShow(created.id, deps);
    expect(formatBook(shown)).toContain('"issue": "PAN-2"');
    expect(formatBookList(runOrdersList(deps))).toContain('2026-07-18-refactor-campaign');

    const moved = await runOrdersMove(created.id, 'PAN-3', { lane: 'A', order: 1 }, deps);
    expect(moved.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ issue: 'PAN-3', lane: 'A', order: 1 }),
    ]));

    const removed = await runOrdersRemove(created.id, 'PAN-1', deps);
    expect(removed.items.map((item) => item.issue)).toEqual(['PAN-3', 'PAN-2']);

    const startOrderBook = vi.fn(async () => ({ runId: 'RUN-99' }));
    await expect(runOrdersStart(created.id, { ...deps, startOrderBook })).resolves.toEqual({ runId: 'RUN-99' });
    expect(startOrderBook).toHaveBeenCalledWith(created.id);
  });

  it('rejects duplicate membership and names the owning non-complete book', async () => {
    const stateRoot = gitFixture();
    await createBook(stateRoot, { id: '2026-07-18-first', name: 'First', createdAt: at });
    await createBook(stateRoot, { id: '2026-07-18-second', name: 'Second', createdAt: at });
    await addItems(stateRoot, '2026-07-18-first', [{
      issue: 'PAN-7',
      lane: 'A',
      order: 1,
      prereqs: [],
      reVerify: false,
    }], 'operator', at);

    await expect(runOrdersAdd('2026-07-18-second', ['PAN-7'], {}, { stateRoot, actor: 'operator' }))
      .rejects.toThrow('Issue PAN-7 already belongs to non-complete order book 2026-07-18-first');
  });

  it('registers every documented verb and option in Commander help', () => {
    const command = createOrdersCommand();
    expect(command.commands.map((child) => child.name())).toEqual([
      'create',
      'list',
      'show',
      'add',
      'remove',
      'move',
      'start',
    ]);
    const add = command.commands.find((child) => child.name() === 'add')!;
    expect(add.options.map((option) => option.long)).toEqual(['--lane', '--after', '--reverify']);
    const move = command.commands.find((child) => child.name() === 'move')!;
    expect(move.options.map((option) => option.long)).toEqual(['--lane', '--order']);
  });
});
