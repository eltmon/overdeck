import { beforeEach, describe, expect, it } from 'vitest';

import {
  dedupeInFlight,
  getMemoized,
  JEV_MAX_CONCURRENT_REQUESTS,
  JEV_MEMO_MAX_ENTRIES,
  jevMemoKey,
  resetJevMemo,
  setMemoized,
  withJevSlot,
} from '../memo.js';

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets queued promise continuations run without any timer. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  resetJevMemo();
});

describe('jev memo LRU (PAN-4369)', () => {
  it('evicts the oldest entry past the cap', () => {
    for (let i = 0; i <= JEV_MEMO_MAX_ENTRIES; i += 1) setMemoized(`k${i}`, i);
    expect(getMemoized('k0')).toBeUndefined();
    expect(getMemoized('k1')).toBe(1);
    expect(getMemoized(`k${JEV_MEMO_MAX_ENTRIES}`)).toBe(JEV_MEMO_MAX_ENTRIES);
  });

  it('keeps an entry that was read before the overflow', () => {
    for (let i = 0; i < JEV_MEMO_MAX_ENTRIES; i += 1) setMemoized(`k${i}`, i);
    expect(getMemoized('k0')).toBe(0);
    setMemoized('overflow', -1);
    expect(getMemoized('k0')).toBe(0);
    expect(getMemoized('k1')).toBeUndefined();
  });
});

describe('dedupeInFlight (PAN-4369)', () => {
  it('runs once for two concurrent calls with the same key', async () => {
    const gate = deferred<string>();
    let runs = 0;
    const run = () => {
      runs += 1;
      return gate.promise;
    };
    const first = dedupeInFlight('same', run);
    const second = dedupeInFlight('same', run);
    gate.resolve('value');
    await expect(Promise.all([first, second])).resolves.toEqual(['value', 'value']);
    expect(runs).toBe(1);
  });

  it('runs again once the first request settled', async () => {
    let runs = 0;
    await dedupeInFlight('k', async () => ++runs);
    await dedupeInFlight('k', async () => ++runs);
    expect(runs).toBe(2);
  });
});

describe('withJevSlot (PAN-4369)', () => {
  it('never runs more than four bodies at once', async () => {
    const gates = Array.from({ length: JEV_MAX_CONCURRENT_REQUESTS + 1 }, () => deferred());
    const started: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const all = gates.map((gate, i) =>
      withJevSlot(async () => {
        started.push(i);
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await gate.promise;
        running -= 1;
      }),
    );

    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    // A new arrival while all slots are busy must queue behind the waiting fifth body.
    const late = withJevSlot(async () => {
      started.push(99);
    });
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[0].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    for (const gate of gates) gate.resolve();
    await Promise.all([...all, late]);
    expect(started).toEqual([0, 1, 2, 3, 4, 99]);
    expect(maxRunning).toBe(JEV_MAX_CONCURRENT_REQUESTS);
  });
});

describe('jevMemoKey (PAN-4369)', () => {
  const base = {
    featureKey: 'jevTurnEndAssessment',
    model: 'm',
    questionSetVersion: 1,
    state: { text: 'hello' },
    questions: { a: 1 },
  };

  it('is stable for identical inputs', () => {
    expect(jevMemoKey(base)).toBe(jevMemoKey({ ...base }));
  });

  it('differs when only the questions differ', () => {
    expect(jevMemoKey(base)).not.toBe(jevMemoKey({ ...base, questions: { b: 1 } }));
  });

  it('differs when only the featureKey differs', () => {
    expect(jevMemoKey(base)).not.toBe(jevMemoKey({ ...base, featureKey: 'jevMemoryRelevance' }));
  });

  it('differs when the model or question-set version differs', () => {
    expect(jevMemoKey(base)).not.toBe(jevMemoKey({ ...base, model: 'n' }));
    expect(jevMemoKey(base)).not.toBe(jevMemoKey({ ...base, questionSetVersion: 2 }));
  });
});
