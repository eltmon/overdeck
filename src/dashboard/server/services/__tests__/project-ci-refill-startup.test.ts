import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markEventStoreProjectionReady,
  resetEventStoreProjectionReadyForTests,
  startProjectCiRefillAfterProjectionReady,
  whenEventStoreProjectionReady,
} from '../project-ci-refill-startup.js';

describe('project CI refill startup', () => {
  beforeEach(() => {
    resetEventStoreProjectionReadyForTests();
  });

  it('waits for the event-store projection subscription before starting the refill', async () => {
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const timer = { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    const start = vi.fn(() => timer);

    const result = startProjectCiRefillAfterProjectionReady(15 * 60 * 1000, {
      whenReady: () => ready,
      start,
      isPeer: () => false,
    });

    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();

    markReady();
    await expect(result).resolves.toBe(timer);
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(15 * 60 * 1000);
  });

  // PAN-3931: a peer shares the primary's event log; the primary runs the refill.
  it('starts no refill in a peer dashboard', async () => {
    const whenReady = vi.fn(async () => undefined);
    const start = vi.fn(() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>);

    await expect(startProjectCiRefillAfterProjectionReady(15 * 60 * 1000, {
      whenReady,
      start,
      isPeer: () => true,
    })).resolves.toBeNull();
    expect(whenReady).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('releases current and future waiters when the projection is marked ready', async () => {
    let settled = false;
    const waiting = whenEventStoreProjectionReady().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    markEventStoreProjectionReady();
    await waiting;
    await expect(whenEventStoreProjectionReady()).resolves.toBeUndefined();

    markEventStoreProjectionReady();
    await expect(whenEventStoreProjectionReady()).resolves.toBeUndefined();
  });
});
