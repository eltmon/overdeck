import { describe, it, expect, beforeEach } from 'vitest';
import { enqueueConversationSend, resetConversationSendQueues } from '../composerSendQueue.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetConversationSendQueues();
});

describe('enqueueConversationSend', () => {
  it('runs tasks for one conversation in enqueue order', async () => {
    const started: string[] = [];
    const a = deferred<void>();

    const taskA = () => {
      started.push('A');
      return a.promise;
    };
    const taskB = () => {
      started.push('B');
      return Promise.resolve();
    };

    const resultA = enqueueConversationSend('conv-1', taskA);
    const resultB = enqueueConversationSend('conv-1', taskB);

    expect(started).toEqual(['A']);

    a.resolve();
    await resultA;
    await resultB;

    expect(started).toEqual(['A', 'B']);
  });

  it('a rejected task does not block the next one', async () => {
    const error = new Error('task A failed');
    const started: string[] = [];

    const resultA = enqueueConversationSend('conv-1', () => {
      started.push('A');
      return Promise.reject(error);
    });
    const resultB = enqueueConversationSend('conv-1', () => {
      started.push('B');
      return Promise.resolve('b-value');
    });

    await expect(resultA).rejects.toThrow('task A failed');
    await expect(resultB).resolves.toBe('b-value');
    expect(started).toEqual(['A', 'B']);
  });

  it('different conversations run concurrently', async () => {
    const started: string[] = [];
    const x = deferred<void>();
    const y = deferred<void>();

    const resultX = enqueueConversationSend('conv-x', () => {
      started.push('x');
      return x.promise;
    });
    const resultY = enqueueConversationSend('conv-y', () => {
      started.push('y');
      return y.promise;
    });

    expect(started).toEqual(['x', 'y']);

    x.resolve();
    y.resolve();
    await resultX;
    await resultY;
  });

  it('starts synchronously on an empty queue', () => {
    let started = false;
    const result = enqueueConversationSend('conv-1', () => {
      started = true;
      return Promise.resolve();
    });

    expect(started).toBe(true);
    void result;
  });
});
