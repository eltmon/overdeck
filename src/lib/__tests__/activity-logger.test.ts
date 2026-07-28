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
 * PAN-3092: FR-4 wants ONE operator warning per episode. Reusing a payload id
 * only makes the reducer replace the visible row — the event is still appended
 * and re-published — so the write door itself has to refuse the second append.
 */
describe('emitActivityEntryOnce (PAN-3092)', () => {
  /** An event log with the same append/query surface as the real store. */
  function createFakeStore(options: { failAppend?: boolean } = {}) {
    const events: Array<{ type: string; payload: { id?: string } }> = [];
    const published: Array<{ type: string }> = [];
    return {
      events,
      published,
      append: vi.fn(() => 1),
      appendAsync: vi.fn(async (event: { type: string; payload: { id?: string } }) => {
        if (options.failAppend) throw new Error('event store unavailable');
        events.push(event);
        published.push(event);
        return events.length;
      }),
      hasEventWithPayloadId: vi.fn((type: string, id: string) =>
        events.some((e) => e.type === type && e.payload?.id === id)),
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

  it('appends once and then refuses to append or publish the same episode again', async () => {
    const fake = createFakeStore();
    setActivityEventStoreProvider(() => fake);

    expect(await emitActivityEntryOnce(warning)).toBe('appended');
    // A "restart" is just another call with no in-memory state behind it.
    expect(await emitActivityEntryOnce(warning)).toBe('duplicate');
    expect(await emitActivityEntryOnce(warning)).toBe('duplicate');

    // One durable event, one publication — not three of either.
    expect(fake.events).toHaveLength(1);
    expect(fake.published).toHaveLength(1);
    expect(fake.appendAsync).toHaveBeenCalledTimes(1);
  });

  it('reports failure instead of swallowing it, so the caller can retry', async () => {
    const failing = createFakeStore({ failAppend: true });
    setActivityEventStoreProvider(() => failing);

    expect(await emitActivityEntryOnce(warning)).toBe('failed');
    expect(failing.events).toHaveLength(0);

    // The retry lands once the store recovers — nothing suppressed it.
    const healthy = createFakeStore();
    setActivityEventStoreProvider(() => healthy);
    expect(await emitActivityEntryOnce(warning)).toBe('appended');
    expect(healthy.events).toHaveLength(1);
  });

  it('reports failure when no event store is wired at all', async () => {
    setActivityEventStoreProvider(null);
    expect(await emitActivityEntryOnce(warning)).toBe('failed');
  });

  it('still appends when the store cannot answer the duplicate query (at-least-once)', async () => {
    // The deacon-child HTTP client can append but not query. Losing the warning
    // there would be worse than repeating it.
    const appendOnly = {
      append: vi.fn(() => 1),
      appendAsync: vi.fn(async () => 1),
    };
    setActivityEventStoreProvider(() => appendOnly);

    expect(await emitActivityEntryOnce(warning)).toBe('appended');
    expect(appendOnly.appendAsync).toHaveBeenCalledTimes(1);
  });
});
