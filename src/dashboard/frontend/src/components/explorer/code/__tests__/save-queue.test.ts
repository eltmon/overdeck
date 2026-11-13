import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSaveQueue, type SaveWrite } from '../save-queue';

interface Deferred {
  key: string;
  req: SaveWrite;
  resolve(signature: string): void;
  reject(error: unknown): void;
}

function harness() {
  const writes: Deferred[] = [];
  const base = new Map<string, string | null>();
  const saved: Array<[string, string, string]> = [];
  const errors: Array<[string, unknown]> = [];
  const queue = createSaveQueue({
    write: (key, req) =>
      new Promise((resolve, reject) => {
        writes.push({ key, req, resolve: (signature) => resolve({ signature }), reject });
      }),
    getBaseSignature: (key) => base.get(key) ?? null,
    onSaved: (key, text, signature) => {
      saved.push([key, text, signature]);
      base.set(key, signature);
    },
    onError: (key, error) => {
      errors.push([key, error]);
    },
  });
  return { queue, writes, base, saved, errors };
}

/** Let resolved promises run their continuations. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSaveQueue', () => {
  it('keeps one write in flight per key', async () => {
    const { queue, writes } = harness();
    queue.enqueue('a', { text: 'one', allowMissing: false });
    queue.enqueue('a', { text: 'two', allowMissing: false });
    await flush();
    expect(writes).toHaveLength(1);
    expect(queue.isInFlight('a')).toBe(true);
  });

  it('sends exactly one more write, with the last text, for three requests during a write', async () => {
    const { queue, writes, saved } = harness();
    queue.enqueue('a', { text: 'one', allowMissing: false });
    for (const text of ['two', 'three', 'four']) queue.enqueue('a', { text, allowMissing: false });
    writes[0]!.resolve('s1');
    await flush();
    expect(writes).toHaveLength(2);
    expect(writes[1]!.req.text).toBe('four');
    writes[1]!.resolve('s4');
    await flush();
    expect(writes).toHaveLength(2);
    expect(saved).toEqual([
      ['a', 'one', 's1'],
      ['a', 'four', 's4'],
    ]);
    expect(queue.isInFlight('a')).toBe(false);
  });

  it('sends the signature the previous write returned', async () => {
    const { queue, writes, base } = harness();
    base.set('a', 's0');
    queue.enqueue('a', { text: 'one', allowMissing: false });
    queue.enqueue('a', { text: 'two', allowMissing: false });
    expect(writes[0]!.req.expectedSignature).toBe('s0');
    writes[0]!.resolve('s1');
    await flush();
    expect(writes[1]!.req.expectedSignature).toBe('s1');
  });

  it('sends a null signature for an overwrite, and a queued overwrite keeps its intent', async () => {
    const { queue, writes, base } = harness();
    base.set('a', 's0');
    queue.enqueue('a', { text: 'one', allowMissing: false, overwrite: true });
    expect(writes[0]!.req.expectedSignature).toBeNull();
    queue.enqueue('a', { text: 'two', allowMissing: false, overwrite: true });
    queue.enqueue('a', { text: 'three', allowMissing: false });
    writes[0]!.resolve('s1');
    await flush();
    expect(writes[1]!.req).toEqual({ text: 'three', expectedSignature: null, allowMissing: false });
  });

  it('keeps allowMissing from an explicit save that an autosave joins', async () => {
    const { queue, writes } = harness();
    queue.enqueue('a', { text: 'one', allowMissing: false });
    queue.enqueue('a', { text: 'two', allowMissing: true });
    queue.enqueue('a', { text: 'three', allowMissing: false });
    writes[0]!.resolve('s1');
    await flush();
    expect(writes[1]!.req).toMatchObject({ text: 'three', allowMissing: true });
  });

  it('drops the queued request and reports the error when a write fails', async () => {
    const { queue, writes, errors, saved } = harness();
    const failure = new Error('DISK_CONFLICT');
    queue.enqueue('a', { text: 'one', allowMissing: false });
    queue.enqueue('a', { text: 'two', allowMissing: false });
    writes[0]!.reject(failure);
    await flush();
    expect(errors).toEqual([['a', failure]]);
    expect(writes).toHaveLength(1);
    expect(saved).toEqual([]);
    expect(queue.isInFlight('a')).toBe(false);
  });

  it('writes two keys in parallel', async () => {
    const { queue, writes } = harness();
    queue.enqueue('a', { text: 'one', allowMissing: false });
    queue.enqueue('b', { text: 'uno', allowMissing: false });
    expect(writes.map((w) => w.key)).toEqual(['a', 'b']);
    expect(queue.isInFlight('a')).toBe(true);
    expect(queue.isInFlight('b')).toBe(true);
  });

  it('whenIdle resolves only after the in-flight and queued writes finish', async () => {
    const { queue, writes } = harness();
    await expect(queue.whenIdle('a')).resolves.toBeUndefined();
    queue.enqueue('a', { text: 'one', allowMissing: false });
    queue.enqueue('a', { text: 'two', allowMissing: false });
    let idle = false;
    void queue.whenIdle('a').then(() => {
      idle = true;
    });
    writes[0]!.resolve('s1');
    await flush();
    expect(idle).toBe(false);
    writes[1]!.resolve('s2');
    await flush();
    expect(idle).toBe(true);
  });
});
