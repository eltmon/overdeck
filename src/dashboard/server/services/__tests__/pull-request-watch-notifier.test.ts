/**
 * PAN-4943 WI-4: the PR watch notifier — D-2 to D-5 wake comparison, D-6
 * persist-then-deliver ordering, D-7 delivery doors (faked here) and the D-13
 * orphan backstop. Real watch store under a temp OVERDECK_HOME; fake deps.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PullRequestSnapshot } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Notifier = typeof import('../pull-request-watch-notifier.js');
type Store = typeof import('../../../../lib/overdeck/pull-request-watches.js');
type PullRequestWatchBaseline = import('../../../../lib/overdeck/pull-request-watches.js').PullRequestWatchBaseline;
type WatchNotifierDeps = import('../pull-request-watch-notifier.js').WatchNotifierDeps;

let notifier: Notifier;
let store: Store;
let home: string;
const originalHome = process.env.OVERDECK_HOME;

const OPEN_PENDING: PullRequestWatchBaseline = { state: 'open', checks: 'pending', reviewState: 'none', mergeable: null };
const PR_URL = 'https://github.com/eltmon/overdeck/pull/7';
const PR_KEY = 'github.com/eltmon/overdeck#7';

function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    state: 'open',
    isDraft: false,
    title: 'title',
    headBranch: null,
    baseBranch: null,
    reviewState: 'none',
    checks: 'pending',
    mergeable: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    author: null,
    updatedAt: null,
    mergedAt: null,
    closedAt: null,
    syncedAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  };
}

async function addWatch(owner: { agentId: string; agentKind: 'agent' | 'conversation' }, last: PullRequestWatchBaseline = OPEN_PENDING) {
  const result = await store.addPullRequestWatch({ ...owner, key: { host: 'github.com', repository: 'eltmon/overdeck', number: 7, url: PR_URL }, last });
  if (!result.ok) throw new Error('unreachable');
  return result.watch;
}

function fakeDeps(overrides: Partial<WatchNotifierDeps> = {}): WatchNotifierDeps & { deliverToAgent: ReturnType<typeof vi.fn>; deliverToConversation: ReturnType<typeof vi.fn> } {
  return {
    listActiveOwners: vi.fn(async () => new Set(['agent:agent-pan-1'])),
    deliverToAgent: vi.fn(async () => true),
    deliverToConversation: vi.fn(async () => true),
    ...overrides,
  } as WatchNotifierDeps & { deliverToAgent: ReturnType<typeof vi.fn>; deliverToConversation: ReturnType<typeof vi.fn> };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4943-pr-notifier-'));
  process.env.OVERDECK_HOME = home;
  store = await import('../../../../lib/overdeck/pull-request-watches.js');
  notifier = await import('../pull-request-watch-notifier.js');
  store._resetPullRequestWatchStoreForTests();
});

afterEach(async () => {
  await store._settlePullRequestWatchWritesForTests();
  store._resetPullRequestWatchStoreForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('watchWake (D-2 to D-5)', () => {
  it('pending to red checks delivers the D-4 text and leaves the watch', async () => {
    const watch = await addWatch({ agentId: 'agent-pan-1', agentKind: 'agent' });
    const wake = notifier.watchWake(watch, snapshot({ checks: 'red' }));
    expect(wake.text).toBe(`[Overdeck] eltmon/overdeck#7: checks failed (was pending). ${PR_URL}`);
    expect(wake.ends).toBe(false);
    expect(wake.last.checks).toBe('red');
  });

  it('open to merged ends the watch with the ended suffix', async () => {
    const watch = await addWatch({ agentId: 'agent-pan-1', agentKind: 'agent' });
    const wake = notifier.watchWake(watch, snapshot({ state: 'merged' }));
    expect(wake.text).toBe(`[Overdeck] eltmon/overdeck#7: merged. ${PR_URL} The watch has ended.`);
    expect(wake.ends).toBe(true);
  });

  it('a checks and review change in one snapshot names both events', async () => {
    const watch = await addWatch({ agentId: 'agent-pan-1', agentKind: 'agent' });
    const wake = notifier.watchWake(watch, snapshot({ checks: 'red', reviewState: 'changes-requested' }));
    expect(wake.text).toBe(`[Overdeck] eltmon/overdeck#7: checks failed (was pending); review is now changes-requested (was none). ${PR_URL}`);
  });

  it('mergeable true -> null -> false: null keeps the previous value, false fires conflicting', () => {
    const watch = { id: 'w1', agentId: 'agent-pan-1', agentKind: 'agent' as const, host: 'github.com', repository: 'eltmon/overdeck', number: 7, url: PR_URL, createdAt: '2026-11-04T00:00:00.000Z', wakes: 0, quietWakes: 0, last: { ...OPEN_PENDING, mergeable: true } };
    const afterNull = notifier.watchWake(watch, snapshot({ mergeable: null }));
    expect(afterNull.text).toBeNull();
    expect(afterNull.last.mergeable).toBe(true);
    const afterFalse = notifier.watchWake({ ...watch, last: afterNull.last }, snapshot({ mergeable: false }));
    expect(afterFalse.text).toBe(`[Overdeck] eltmon/overdeck#7: has merge conflicts. ${PR_URL}`);
  });

  it('a checks-passed wake resets quietWakes to 0', () => {
    const watch = { id: 'w1', agentId: 'agent-pan-1', agentKind: 'agent' as const, host: 'github.com', repository: 'eltmon/overdeck', number: 7, url: PR_URL, createdAt: '2026-11-04T00:00:00.000Z', wakes: 3, quietWakes: 5, last: { ...OPEN_PENDING, reviewState: 'commented' as const, checks: 'red' as const } };
    const wake = notifier.watchWake(watch, snapshot({ checks: 'green' }));
    expect(wake.quietWakes).toBe(0);
  });

  it('11 consecutive review-only wakes end the watch on the 11th', () => {
    let watch = { id: 'w1', agentId: 'agent-pan-1', agentKind: 'agent' as const, host: 'github.com', repository: 'eltmon/overdeck', number: 7, url: PR_URL, createdAt: '2026-11-04T00:00:00.000Z', wakes: 0, quietWakes: 0, last: { ...OPEN_PENDING, reviewState: 'none' as const } };
    const reviewStates = ['approved', 'commented', 'changes-requested', 'review-requested', 'none', 'commented', 'approved', 'commented', 'none', 'commented', 'approved'] as const;
    let lastWake;
    for (const reviewState of reviewStates) {
      lastWake = notifier.watchWake(watch, snapshot({ reviewState }));
      watch = { ...watch, last: lastWake.last, quietWakes: lastWake.quietWakes };
    }
    expect(lastWake!.quietWakes).toBe(11);
    expect(lastWake!.ends).toBe(true);
    expect(lastWake!.text).toContain('The watch has ended after 10 review-only updates');
  });
});

describe('notifyPullRequestWatches (D-6, D-7, D-13)', () => {
  it('an empty store never calls listActiveOwners', async () => {
    const deps = fakeDeps();
    const result = await notifier.notifyPullRequestWatches(new Map(), deps);
    expect(result).toEqual({ delivered: 0, ended: 0, dropped: 0 });
    expect(deps.listActiveOwners).not.toHaveBeenCalled();
  });

  it('delivers exactly one message for a pending-to-red snapshot, none again for the same snapshot, and an agent dedupKey of wakes 1', async () => {
    const watch = await addWatch({ agentId: 'agent-pan-1', agentKind: 'agent' });
    const deps = fakeDeps();
    const snapshots = new Map([[PR_KEY, snapshot({ checks: 'red' })]]);

    const first = await notifier.notifyPullRequestWatches(snapshots, deps);
    expect(first).toEqual({ delivered: 1, ended: 0, dropped: 0 });
    expect(deps.deliverToAgent).toHaveBeenCalledWith('agent-pan-1', expect.stringContaining('checks failed'), `pr-watch:${watch.id}:1`);

    const second = await notifier.notifyPullRequestWatches(snapshots, deps);
    expect(second).toEqual({ delivered: 0, ended: 0, dropped: 0 });
    expect(deps.deliverToAgent).toHaveBeenCalledTimes(1);
  });

  it('red, then pending, then red again delivers twice in total', async () => {
    await addWatch({ agentId: 'agent-pan-1', agentKind: 'agent' });
    const deps = fakeDeps();
    await notifier.notifyPullRequestWatches(new Map([[PR_KEY, snapshot({ checks: 'red' })]]), deps);
    await notifier.notifyPullRequestWatches(new Map([[PR_KEY, snapshot({ checks: 'pending' })]]), deps);
    await notifier.notifyPullRequestWatches(new Map([[PR_KEY, snapshot({ checks: 'red' })]]), deps);
    expect(deps.deliverToAgent).toHaveBeenCalledTimes(2);
  });

  it('open to merged delivers one ended message and removes the watch', async () => {
    await addWatch({ agentId: 'agent-pan-1', agentKind: 'agent' });
    const deps = fakeDeps();
    const result = await notifier.notifyPullRequestWatches(new Map([[PR_KEY, snapshot({ state: 'merged' })]]), deps);
    expect(result).toEqual({ delivered: 1, ended: 1, dropped: 0 });
    expect(deps.deliverToAgent).toHaveBeenCalledWith('agent-pan-1', expect.stringContaining('The watch has ended.'), expect.any(String));
    expect(await store.listPullRequestWatches()).toEqual([]);
  });

  it('an owner with no active token is dropped with no delivery', async () => {
    await addWatch({ agentId: 'agent-pan-1', agentKind: 'agent' });
    const deps = fakeDeps({ listActiveOwners: vi.fn(async () => new Set<string>()) });
    const result = await notifier.notifyPullRequestWatches(new Map([[PR_KEY, snapshot({ checks: 'red' })]]), deps);
    expect(result).toEqual({ delivered: 0, ended: 0, dropped: 1 });
    expect(deps.deliverToAgent).not.toHaveBeenCalled();
    expect(await store.listPullRequestWatches()).toEqual([]);
  });

  it('a conversation owner delivers through deliverToConversation', async () => {
    await addWatch({ agentId: 'conv-a', agentKind: 'conversation' });
    const deps = fakeDeps({ listActiveOwners: vi.fn(async () => new Set(['conversation:conv-a'])) });
    const result = await notifier.notifyPullRequestWatches(new Map([[PR_KEY, snapshot({ checks: 'red' })]]), deps);
    expect(result).toEqual({ delivered: 1, ended: 0, dropped: 0 });
    expect(deps.deliverToConversation).toHaveBeenCalledWith('conv-a', expect.stringContaining('checks failed'));
  });

  it('a delivery that throws is logged, counted as not delivered, and the store still holds the new baseline', async () => {
    const watch = await addWatch({ agentId: 'agent-pan-1', agentKind: 'agent' });
    const deps = fakeDeps({ deliverToAgent: vi.fn(async () => { throw new Error('boom'); }) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await notifier.notifyPullRequestWatches(new Map([[PR_KEY, snapshot({ checks: 'red' })]]), deps);
    expect(result).toEqual({ delivered: 0, ended: 0, dropped: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`[pr-watch] delivery to agent:agent-pan-1 failed: boom`));
    const stored = await store.listPullRequestWatches();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(watch.id);
    expect(stored[0]!.last.checks).toBe('red');
    expect(stored[0]!.wakes).toBe(1);
  });
});
