/**
 * PAN-4943 WI-2: pr-watches.json — 0600 atomic writes, owner/total limits,
 * duplicate adds, owner-scoped removal, and a corrupt file that throws and
 * is never rewritten.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Store = typeof import('../../../../src/lib/overdeck/pull-request-watches.js');
type PullRequestWatchBaseline = import('../../../../src/lib/overdeck/pull-request-watches.js').PullRequestWatchBaseline;

let store: Store;
let home: string;
const originalHome = process.env.OVERDECK_HOME;

const baseline: PullRequestWatchBaseline = { state: 'open', checks: 'pending', reviewState: 'none', mergeable: true };

function key(number: number, overrides: Partial<{ host: string; repository: string }> = {}) {
  return { host: 'github.com', repository: 'eltmon/overdeck', number, url: `https://github.com/eltmon/overdeck/pull/${number}`, ...overrides };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4943-pr-watches-'));
  process.env.OVERDECK_HOME = home;
  store = await import('../../../../src/lib/overdeck/pull-request-watches.js');
  store._resetPullRequestWatchStoreForTests();
});

afterEach(async () => {
  await store._settlePullRequestWatchWritesForTests();
  store._resetPullRequestWatchStoreForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('pull-request-watches store (PAN-4943 WI-2)', () => {
  it('writes pr-watches.json with mode 0600; a duplicate owner+key add returns created: false with one stored row', async () => {
    const owner = { agentId: 'agent-pan-1', agentKind: 'agent' as const };
    const first = await store.addPullRequestWatch({ ...owner, key: key(1), last: baseline });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(first.created).toBe(true);

    const path = join(home, 'pr-watches.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const second = await store.addPullRequestWatch({ ...owner, key: key(1), last: baseline });
    expect(second).toEqual({ ok: true, watch: first.watch, created: false });
    expect(await store.listPullRequestWatches()).toEqual([first.watch]);
  });

  it('refuses a 21st watch for one owner and a 51st watch overall', async () => {
    const owner = { agentId: 'agent-pan-1', agentKind: 'agent' as const };
    for (let i = 1; i <= 20; i++) {
      const result = await store.addPullRequestWatch({ ...owner, key: key(i), last: baseline });
      expect(result.ok).toBe(true);
    }
    const ownerLimited = await store.addPullRequestWatch({ ...owner, key: key(21), last: baseline });
    expect(ownerLimited).toEqual({ ok: false, code: 'owner-limit' });

    for (let i = 1; i <= 30; i++) {
      const other = { agentId: `agent-pan-${i + 1}`, agentKind: 'agent' as const };
      const result = await store.addPullRequestWatch({ ...other, key: key(1000 + i), last: baseline });
      expect(result.ok).toBe(true);
    }
    const totalLimited = await store.addPullRequestWatch({ agentId: 'agent-pan-last', agentKind: 'agent' as const, key: key(2000), last: baseline });
    expect(totalLimited).toEqual({ ok: false, code: 'total-limit' });
    expect(await store.listPullRequestWatches()).toHaveLength(50);
  });

  it("removePullRequestWatch refuses another owner's id and preserves the row; removePullRequestWatchesForOwner returns the count and keeps other owners' rows", async () => {
    const ownerA = { agentId: 'agent-pan-1', agentKind: 'agent' as const };
    const ownerB = { agentId: 'agent-pan-2', agentKind: 'agent' as const };
    const addA1 = await store.addPullRequestWatch({ ...ownerA, key: key(1), last: baseline });
    const addA2 = await store.addPullRequestWatch({ ...ownerA, key: key(2), last: baseline });
    const addB1 = await store.addPullRequestWatch({ ...ownerB, key: key(3), last: baseline });
    if (!addA1.ok || !addA2.ok || !addB1.ok) throw new Error('unreachable');

    expect(await store.removePullRequestWatch(addA1.watch.id, ownerB)).toBe(false);
    expect(await store.listPullRequestWatches(ownerA)).toHaveLength(2);

    expect(await store.removePullRequestWatchesForOwner(ownerA)).toBe(2);
    expect(await store.listPullRequestWatches(ownerA)).toEqual([]);
    expect(await store.listPullRequestWatches(ownerB)).toEqual([addB1.watch]);
    expect(await store.removePullRequestWatchesForOwner(ownerA)).toBe(0);
  });

  it('throws on a corrupt file and leaves it unchanged', async () => {
    const path = join(home, 'pr-watches.json');
    await writeFile(path, '{"v":1,"watches":[{"id":', 'utf8');
    await expect(store.listPullRequestWatches()).rejects.toThrow('pr-watches.json is corrupt');
    await expect(store.addPullRequestWatch({ agentId: 'agent-pan-1', agentKind: 'agent', key: key(1), last: baseline })).rejects.toThrow('pr-watches.json is corrupt');
    expect(await readFile(path, 'utf8')).toBe('{"v":1,"watches":[{"id":');
  });

  it('throws on a wrong version and leaves the file unchanged', async () => {
    const path = join(home, 'pr-watches.json');
    await writeFile(path, '{"v":2,"watches":[]}', 'utf8');
    await expect(store.listPullRequestWatches()).rejects.toThrow('pr-watches.json is corrupt');
    expect(await readFile(path, 'utf8')).toBe('{"v":2,"watches":[]}');
  });

  it('reads a missing file, and a zero-byte file, as empty', async () => {
    expect(await store.listPullRequestWatches()).toEqual([]);
    await writeFile(join(home, 'pr-watches.json'), '', 'utf8');
    expect(await store.listPullRequestWatches()).toEqual([]);
  });
});

describe('baselineFromSnapshot (D-2)', () => {
  it('keeps the previous mergeable value when the snapshot has null', () => {
    const snapshot = { state: 'open', checks: 'red', reviewState: 'approved', mergeable: null } as Parameters<Store['baselineFromSnapshot']>[0];
    expect(store.baselineFromSnapshot(snapshot, { ...baseline, mergeable: false })).toEqual({ state: 'open', checks: 'red', reviewState: 'approved', mergeable: false });
    expect(store.baselineFromSnapshot(snapshot)).toEqual({ state: 'open', checks: 'red', reviewState: 'approved', mergeable: null });
  });

  it('takes the snapshot mergeable value when it is not null', () => {
    const snapshot = { state: 'open', checks: 'green', reviewState: 'none', mergeable: true } as Parameters<Store['baselineFromSnapshot']>[0];
    expect(store.baselineFromSnapshot(snapshot, { ...baseline, mergeable: false })).toEqual({ state: 'open', checks: 'green', reviewState: 'none', mergeable: true });
  });
});
