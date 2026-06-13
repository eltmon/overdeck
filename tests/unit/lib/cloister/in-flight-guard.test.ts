import { describe, it, expect, vi } from 'vitest';
import { createInFlightGuard } from '../../../../src/lib/cloister/in-flight-guard.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain a few microtask ticks so the guard's detached finally{} runs. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('createInFlightGuard (PAN-328 postMergeLifecycle idempotency invariant)', () => {
  it('skips a concurrent re-entry for the same key — the task fires exactly once', async () => {
    const guard = createInFlightGuard();
    const gate = deferred();
    const task = vi.fn(() => gate.promise);

    const first = guard.run('PAN-9999', task);
    const second = guard.run('PAN-9999', task); // already in flight → must skip

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(task).toHaveBeenCalledTimes(1);
    expect(guard.isInFlight('PAN-9999')).toBe(true);

    gate.resolve();
    await gate.promise;
    await flush();
    expect(guard.isInFlight('PAN-9999')).toBe(false);
  });

  it('runs again for the same key once the prior run has settled (guards concurrency, not forever)', async () => {
    const guard = createInFlightGuard();
    const g1 = deferred();
    const task = vi
      .fn()
      .mockImplementationOnce(() => g1.promise)
      .mockImplementationOnce(() => Promise.resolve());

    guard.run('PAN-1', task);
    g1.resolve();
    await g1.promise;
    await flush();

    const again = guard.run('PAN-1', task);
    expect(again).toBe(true);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('treats different keys independently', () => {
    const guard = createInFlightGuard();
    const gate = deferred();
    expect(guard.run('A', () => gate.promise)).toBe(true);
    expect(guard.run('B', () => gate.promise)).toBe(true);
    gate.resolve();
  });

  it('releases the key and reports the error when the task rejects', async () => {
    const guard = createInFlightGuard();
    const gate = deferred();
    const onError = vi.fn();

    guard.run('PAN-7', () => gate.promise, onError);
    gate.reject(new Error('boom'));
    await gate.promise.catch(() => {});
    await flush();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(guard.isInFlight('PAN-7')).toBe(false);
  });
});
