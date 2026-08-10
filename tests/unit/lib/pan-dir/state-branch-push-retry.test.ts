/**
 * The state write door must converge when a concurrent writer lands
 * overdeck-state commits between our last fetch and our push, instead of
 * failing the domain write with a raw non-fast-forward rejection. Covers the
 * 2026-08-09 incident where an order-book persist failed with "cannot lock
 * ref 'refs/heads/overdeck-state' ... but expected ...".
 *
 * Two clones of one bare origin act as the two writers. Disjoint writes must
 * rebase+retry to success; same-line conflicts must abort the rebase, report
 * the failure honestly, and leave the worktree clean with the local commit
 * intact.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OrderBook } from '@overdeck/contracts';
import { createBook, renameBook } from '../../../../src/lib/orders/writer.js';

const at = '2026-08-09T12:00:00.000Z';
const roots: string[] = [];

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Clone-local origin URL for assertions against what actually reached the remote. */
function originHead(origin: string, path: string): string {
  return git(['show', `overdeck-state:${path}`], origin);
}

function makeWriter(origin: string): string {
  const root = mkdtempSync(join(tmpdir(), 'overdeck-state-push-retry-writer-'));
  roots.push(root);
  execFileSync('git', ['clone', origin, root], { encoding: 'utf8' });
  git(['config', 'user.name', 'State Push Retry Test'], root);
  git(['config', 'user.email', 'state-push-retry@example.com'], root);
  git(['checkout', 'overdeck-state'], root);
  return root;
}

let origin: string;
let stateRoot: string;

beforeEach(() => {
  // A scratch OVERDECK_HOME keeps queueAutoCommit's migrated-state-home
  // redirect from retargeting the fixture writes at the real state worktree
  // (the fixture root sits under the real project checkout).
  process.env['OVERDECK_HOME'] = mkdtempSync(join(tmpdir(), 'overdeck-state-push-retry-home-'));
  roots.push(process.env['OVERDECK_HOME']);

  origin = mkdtempSync(join(tmpdir(), 'overdeck-state-push-retry-origin-'));
  roots.push(origin);
  rmSync(origin, { recursive: true, force: true });
  execFileSync('git', ['init', '--bare', origin], { encoding: 'utf8' });

  stateRoot = mkdtempSync(join(tmpdir(), 'overdeck-state-push-retry-root-'));
  roots.push(stateRoot);
  git(['init'], stateRoot);
  git(['config', 'user.name', 'State Push Retry Test'], stateRoot);
  git(['config', 'user.email', 'state-push-retry@example.com'], stateRoot);
  writeFileSync(join(stateRoot, 'migration-complete.json'), JSON.stringify({ seededAt: at }), 'utf8');
  git(['add', 'migration-complete.json'], stateRoot);
  git(['commit', '-m', 'seed'], stateRoot);
  git(['branch', '-M', 'overdeck-state'], stateRoot);
  git(['remote', 'add', 'origin', origin], stateRoot);
  git(['push', '-u', 'origin', 'overdeck-state'], stateRoot);
});

afterEach(() => {
  delete process.env['OVERDECK_HOME'];
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('state-branch push retry after a non-fast-forward rejection', () => {
  it('rebases and pushes when a concurrent writer touched disjoint files', async () => {
    const competitor = makeWriter(origin);
    mkdirSync(join(competitor, 'records'), { recursive: true });
    writeFileSync(join(competitor, 'records', 'pan-9999.json'), '{"issueId":"PAN-9999"}\n', 'utf8');
    git(['add', 'records/pan-9999.json'], competitor);
    git(['commit', '-m', 'competing state write'], competitor);
    git(['push', 'origin', 'overdeck-state'], competitor);

    // stateRoot is now stale: its tracking ref predates the competitor push.
    await expect(createBook(stateRoot, { id: '2026-08-09-book-a', name: 'Book A', createdAt: at })).resolves.toBeTruthy();

    // The remote carries both writes, and the local branch replayed linearly
    // on top of the competitor's commit.
    expect(originHead(origin, 'records/pan-9999.json')).toContain('PAN-9999');
    expect(originHead(origin, 'orders/2026-08-09-book-a.json')).toContain('2026-08-09-book-a');
    git(['fetch', 'origin', 'overdeck-state'], stateRoot);
    expect(git(['rev-parse', 'HEAD'], stateRoot)).toBe(git(['rev-parse', 'origin/overdeck-state'], stateRoot));
  });

  it('aborts a conflicting rebase, reports the failure, and leaves the tree clean', async () => {
    await createBook(stateRoot, { id: '2026-08-09-shared', name: 'original', createdAt: at });

    const competitor = makeWriter(origin);
    const bookPath = join(competitor, 'orders', '2026-08-09-shared.json');
    const renamed = JSON.parse(readFileSync(bookPath, 'utf8')) as OrderBook;
    renamed.name = 'competitor-name';
    writeFileSync(bookPath, `${JSON.stringify(renamed, null, 2)}\n`, 'utf8');
    const indexPath = join(competitor, 'orders', 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Array<{ id: string; name: string }>;
    for (const entry of index) if (entry.id === '2026-08-09-shared') entry.name = 'competitor-name';
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    git(['add', 'orders/2026-08-09-shared.json', 'orders/index.json'], competitor);
    git(['commit', '-m', 'competing rename'], competitor);
    git(['push', 'origin', 'overdeck-state'], competitor);

    // stateRoot rewrites the same "name" line on a stale base: the rebase must
    // conflict, abort, and surface the failure rather than decide content.
    await expect(renameBook(stateRoot, '2026-08-09-shared', 'local-name')).rejects.toThrow(/rebase conflicted/);

    expect(git(['status', '--porcelain'], stateRoot)).toBe('');
    const rebaseMerge = git(['rev-parse', '--git-path', 'rebase-merge'], stateRoot);
    expect(existsSync(rebaseMerge)).toBe(false);
    // The local commit survived (nothing rolled back); the remote kept the
    // competitor's version.
    const localBook = JSON.parse(readFileSync(join(stateRoot, 'orders', '2026-08-09-shared.json'), 'utf8')) as OrderBook;
    expect(localBook.name).toBe('local-name');
    expect(originHead(origin, 'orders/2026-08-09-shared.json')).toContain('competitor-name');
  });
});
