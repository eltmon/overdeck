import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emitActivityEntryDurable,
  emitActivityEntryOnce,
  emitActivityEntrySync,
  emitActivityTtsSync,
  emitDashboardLifecycleSync,
  setActivityEventStoreProvider,
} from '../activity-logger.js';

const store = {
  append: vi.fn(() => 1),
  appendAsync: vi.fn(async () => 1),
};

describe('activity logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivityEventStoreProvider(() => store);
  });

  afterEach(() => {
    setActivityEventStoreProvider(null);
  });

  it('persists activity events asynchronously', () => {
    emitActivityEntrySync({ source: 'cloister', level: 'info', message: 'review started', issueId: 'PAN-829' });
    emitActivityTtsSync({ utterance: 'PAN-829 review started', issueId: 'PAN-829' });

    expect(store.append).not.toHaveBeenCalled();
    expect(store.appendAsync).toHaveBeenCalledTimes(2);
    expect(store.appendAsync.mock.calls[0][0]).toMatchObject({ type: 'activity.entry' });
    expect(store.appendAsync.mock.calls[1][0]).toMatchObject({ type: 'activity.tts' });
  });

  it('awaits durable structured activity transitions with caller-provided ids', async () => {
    await emitActivityEntryDurable({
      id: 'activity-1525',
      source: 'work-agent',
      level: 'error',
      status: 'failed',
      command: '/pan start PAN-1525',
      message: 'Detached command failed',
      output: 'Project resolution failed',
      issueId: 'PAN-1525',
    });

    expect(store.appendAsync).toHaveBeenCalledWith(expect.objectContaining({
      type: 'activity.entry',
      payload: expect.objectContaining({
        id: 'activity-1525',
        status: 'failed',
        command: '/pan start PAN-1525',
        output: 'Project resolution failed',
      }),
    }));
  });

  it('rejects durable activity writes when the canonical event store is unavailable', async () => {
    setActivityEventStoreProvider(null);

    await expect(emitActivityEntryDurable({
      source: 'work-agent',
      level: 'info',
      message: 'Detached command accepted',
    })).rejects.toThrow('Activity event store is not initialized.');
  });

  it('mirrors dashboard lifecycle events into the ActivityPanel feed', () => {
    emitDashboardLifecycleSync('started', {
      reason: 'post-merge',
      issueId: 'PAN-1744',
      trigger: 'deploy-script',
    });

    expect(store.appendAsync).not.toHaveBeenCalled();
    expect(store.append).toHaveBeenCalledTimes(2);
    expect(store.append.mock.calls[0][0]).toMatchObject({
      type: 'dashboard.lifecycle_started',
      payload: {
        reason: 'post-merge',
        issueId: 'PAN-1744',
        trigger: 'deploy-script',
      },
    });
    expect(store.append.mock.calls[1][0]).toMatchObject({
      type: 'activity.entry',
      payload: {
        source: 'deploy-script',
        level: 'info',
        message: 'Dashboard restart started via deploy-script for PAN-1744 (post-merge)',
        issueId: 'PAN-1744',
      },
    });
  });
});

/**
 * PAN-3092: FR-4 wants ONE operator warning per episode. Neither append path
 * can back that on its own — the deacon client resolves on local enqueue and
 * the in-process store resolves a failed batch with sequence 0 — so the write
 * door delegates to a settled, transactional `appendOnce`.
 */
describe('emitActivityEntryOnce (PAN-3092)', () => {
  /** A store whose appendOnce behaves like the real transactional one. */
  function createStore(options: { fail?: boolean } = {}) {
    const events: Array<{ type: string; payload: { id?: string } }> = [];
    const published: Array<{ type: string }> = [];
    const claimed = new Set<string>();
    return {
      events,
      published,
      append: vi.fn(() => 1),
      appendAsync: vi.fn(async () => 1),
      appendOnce: vi.fn((event: { type: string; payload: { id?: string } }, key: string) => {
        if (options.fail) throw new Error('transaction did not commit');
        if (claimed.has(key)) return { outcome: 'duplicate' as const };
        claimed.add(key);
        events.push(event);
        published.push(event);
        return { outcome: 'appended' as const };
      }),
    };
  }

  const warning = {
    id: 'verdict-fallback:verdict-fallback-contention:PAN-3092:2026-07-28T00:00:00.000Z',
    source: 'cloister' as const,
    level: 'warn' as const,
    message: 'verdict fallback undrained',
    issueId: 'PAN-3092',
  };

  afterEach(() => {
    setActivityEventStoreProvider(null);
  });

  it('appends once and then neither appends nor publishes the same episode again', async () => {
    const store = createStore();
    setActivityEventStoreProvider(() => store);

    expect(await emitActivityEntryOnce(warning)).toBe('appended');
    // A restart is just another call with no in-memory state behind it.
    expect(await emitActivityEntryOnce(warning)).toBe('duplicate');
    expect(await emitActivityEntryOnce(warning)).toBe('duplicate');

    expect(store.events).toHaveLength(1);
    expect(store.published).toHaveLength(1);
    // The unbatched, non-durable path is never used for this.
    expect(store.appendAsync).not.toHaveBeenCalled();
  });

  it('passes the caller id through as the idempotency key', async () => {
    const store = createStore();
    setActivityEventStoreProvider(() => store);

    await emitActivityEntryOnce(warning);

    expect(store.appendOnce.mock.calls[0]![1]).toBe(warning.id);
  });

  it('reports failed when the transaction does not commit, so the caller retries', async () => {
    setActivityEventStoreProvider(() => createStore({ fail: true }));
    expect(await emitActivityEntryOnce(warning)).toBe('failed');

    const healthy = createStore();
    setActivityEventStoreProvider(() => healthy);
    expect(await emitActivityEntryOnce(warning)).toBe('appended');
    expect(healthy.events).toHaveLength(1);
  });

  it('relays a failed outcome from an async (deacon-client) appendOnce', async () => {
    setActivityEventStoreProvider(() => ({
      append: vi.fn(() => 1),
      appendAsync: vi.fn(async () => 1),
      appendOnce: vi.fn(async () => 'failed' as const),
    }));

    expect(await emitActivityEntryOnce(warning)).toBe('failed');
  });

  it('reports failure when no event store is wired at all', async () => {
    setActivityEventStoreProvider(null);
    expect(await emitActivityEntryOnce(warning)).toBe('failed');
  });

  it('reports unconfirmed — never appended — when the store offers no settled path', async () => {
    // A narrow stub cannot guarantee anything; saying "appended" here is the
    // false-success this whole change exists to remove.
    const stub = { append: vi.fn(() => 1), appendAsync: vi.fn(async () => 1) };
    setActivityEventStoreProvider(() => stub);

    expect(await emitActivityEntryOnce(warning)).toBe('unconfirmed');
    expect(stub.appendAsync).toHaveBeenCalledTimes(1);
  });
});
