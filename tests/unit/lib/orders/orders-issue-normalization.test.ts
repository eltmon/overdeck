/**
 * Order books written with bare issue numbers ("2351") must resolve as the
 * project's prefixed issues ("PAN-2351") everywhere: the read door expands
 * them using the state root's project prefix, and the write door canonicalizes
 * on entry. Locks the fix for start validation reporting "could not be
 * resolved as an open issue" for every bare-number item.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OrderBook } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectMocks = vi.hoisted(() => ({
  getProjectSync: vi.fn(),
  findProjectByPathSync: vi.fn(),
}));

vi.mock('../../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/paths.js')>();
  return {
    ...actual,
    getOverdeckHome: () => process.env['OVERDECK_TEST_FAKE_HOME'] ?? actual.getOverdeckHome(),
  };
});

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/projects.js')>();
  return {
    ...actual,
    getProjectSync: (...args: unknown[]) => projectMocks.getProjectSync(...args),
    findProjectByPathSync: (...args: unknown[]) => projectMocks.findProjectByPathSync(...args),
  };
});

import { getBook, getBookAsync, listBooks } from '../../../../src/lib/orders/resolver.js';
import { addItems, removeItem } from '../../../../src/lib/orders/writer.js';

const at = '2026-08-09T12:00:00.000Z';
let fakeHome: string;
const roots: string[] = [];

/** A migrated-layout state root: <fakeHome>/state/<projectKey>. */
function stateRoot(projectKey = 'panopticon-cli'): string {
  const root = join(fakeHome!, 'state', projectKey);
  roots.push(root);
  mkdirSync(join(root, 'orders'), { recursive: true });
  writeFileSync(join(root, 'orders', 'index.json'), '[]', 'utf8');
  return root;
}

function book(items: OrderBook['items'], id = '2026-08-09-anywhere'): OrderBook {
  return {
    id,
    name: 'Overdeck Anywhere',
    status: 'draft',
    settings: { laneAConcurrency: 1, posture: 'open' },
    items,
    createdAt: at,
    updatedAt: at,
  };
}

function item(issue: string, prereqs: string[] = []): OrderBook['items'][number] {
  return { issue, lane: 'A', order: 1, prereqs, reVerify: false, addedAt: at, addedBy: 'operator' };
}

function writeBook(root: string, value: OrderBook): void {
  writeFileSync(join(root, 'orders', `${value.id}.json`), JSON.stringify(value), 'utf8');
  writeFileSync(
    join(root, 'orders', 'index.json'),
    JSON.stringify([{ id: value.id, name: value.name, status: value.status, updatedAt: value.updatedAt }]),
    'utf8',
  );
}

function storedBook(root: string, id: string): OrderBook {
  return JSON.parse(readFileSync(join(root, 'orders', `${id}.json`), 'utf8')) as OrderBook;
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'overdeck-orders-prefix-home-'));
  process.env['OVERDECK_TEST_FAKE_HOME'] = fakeHome;
});

afterEach(() => {
  delete process.env['OVERDECK_TEST_FAKE_HOME'];
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  projectMocks.getProjectSync.mockReset();
  projectMocks.findProjectByPathSync.mockReset();
});

describe('order-book issue id normalization', () => {
  it('expands bare-number items and prereqs through the read door', async () => {
    const root = stateRoot();
    projectMocks.getProjectSync.mockReturnValue({ name: 'panopticon-cli', path: '/unused', issue_prefix: 'PAN' });
    projectMocks.findProjectByPathSync.mockReturnValue(null);
    writeBook(root, book([item('2351', ['2350']), item('PAN-1166')]));

    const read = getBook(root, '2026-08-09-anywhere');
    expect(read?.items.map((entry) => entry.issue)).toEqual(['PAN-2351', 'PAN-1166']);
    expect(read?.items[0]?.prereqs).toEqual(['PAN-2350']);
    expect(listBooks(root)[0]?.items.map((entry) => entry.issue)).toEqual(['PAN-2351', 'PAN-1166']);
    const asyncRead = await getBookAsync(root, '2026-08-09-anywhere');
    expect(asyncRead?.items.map((entry) => entry.issue)).toEqual(['PAN-2351', 'PAN-1166']);
    // The stored file is untouched — read-door normalization is not surgery.
    expect(storedBook(root, '2026-08-09-anywhere').items.map((entry) => entry.issue)).toEqual(['2351', 'PAN-1166']);
  });

  it('leaves ids untouched when no project prefix is derivable', () => {
    const root = stateRoot();
    projectMocks.getProjectSync.mockReturnValue(null);
    projectMocks.findProjectByPathSync.mockReturnValue(null);
    writeBook(root, book([item('2351')]));

    expect(getBook(root, '2026-08-09-anywhere')?.items.map((entry) => entry.issue)).toEqual(['2351']);
  });

  it('prefers the path-containment project match for legacy roots', () => {
    const root = join(fakeHome, 'Projects', 'legacy-checkout');
    roots.push(root);
    mkdirSync(join(root, 'orders'), { recursive: true });
    writeFileSync(join(root, 'orders', 'index.json'), '[]', 'utf8');
    projectMocks.findProjectByPathSync.mockReturnValue({ name: 'legacy', path: root, issue_prefix: 'LEG' });
    projectMocks.getProjectSync.mockReturnValue(null);
    writeBook(root, book([item('42')]));

    expect(getBook(root, '2026-08-09-anywhere')?.items[0]?.issue).toBe('LEG-42');
  });

  it('canonicalizes bare numbers at the write door (addItems)', async () => {
    const root = stateRoot();
    projectMocks.getProjectSync.mockReturnValue({ name: 'panopticon-cli', path: '/unused', issue_prefix: 'PAN' });
    projectMocks.findProjectByPathSync.mockReturnValue(null);
    writeBook(root, book([]));

    await addItems(root, '2026-08-09-anywhere', [item('2351'), item('pan-2352')], 'operator');

    expect(storedBook(root, '2026-08-09-anywhere').items.map((entry) => entry.issue)).toEqual(['PAN-2351', 'PAN-2352']);
  });

  it('matches per-issue verbs by canonical id (removeItem accepts bare numbers)', async () => {
    const root = stateRoot();
    projectMocks.getProjectSync.mockReturnValue({ name: 'panopticon-cli', path: '/unused', issue_prefix: 'PAN' });
    projectMocks.findProjectByPathSync.mockReturnValue(null);
    writeBook(root, book([item('2351'), item('2352')]));

    const updated = await removeItem(root, '2026-08-09-anywhere', '2351');

    expect(updated.items.map((entry) => entry.issue)).toEqual(['PAN-2352']);
    expect(storedBook(root, '2026-08-09-anywhere').items.map((entry) => entry.issue)).toEqual(['PAN-2352']);
  });
});
