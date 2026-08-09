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
    });

    await Promise.resolve();
    expect(start).not.toHaveBeenCalled();

    markReady();
    await expect(result).resolves.toBe(timer);
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(15 * 60 * 1000);
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
