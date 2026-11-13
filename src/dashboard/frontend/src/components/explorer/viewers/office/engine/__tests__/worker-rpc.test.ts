/** PAN-5189 WI-6: createWorkerClient posts requests, resolves replies, maps superseded replies, and fails pending calls on error. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkerClient, type Methods } from '../worker-rpc';

type FakeMethods = Methods & {
  m: { input: number; output: number };
};

class FakeWorker {
  readonly posted: Array<{ id: number; method: string; key?: string; input: unknown }> = [];
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener() {}
  postMessage(message: { id: number; method: string; key?: string; input: unknown }) {
    this.posted.push(message);
  }
  terminate() {}
  emitMessage(data: unknown) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data } as MessageEvent);
  }
  emitError(message: string) {
    for (const listener of this.listeners.get('error') ?? [])
      listener({ message } as unknown as MessageEvent);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createWorkerClient', () => {
  it('posts the request and resolves with the reply value', async () => {
    const fake = new FakeWorker();
    const client = createWorkerClient<FakeMethods>(fake as unknown as Worker);
    const result = client.call('m', 1);
    expect(fake.posted[0]).toMatchObject({ id: 1, method: 'm', input: 1 });
    fake.emitMessage({ id: 1, ok: true, value: 5, transferred: [] });
    await expect(result).resolves.toBe(5);
  });

  it('rejects a superseded call with a SupersededError', async () => {
    const fake = new FakeWorker();
    const client = createWorkerClient<FakeMethods>(fake as unknown as Worker);
    const result = client.call('m', 1);
    fake.emitMessage({ id: 1, ok: false, superseded: true, message: 'x' });
    await expect(result).rejects.toMatchObject({ _tag: 'SupersededError' });
  });

  it('rejects a new call after the worker errors', async () => {
    const fake = new FakeWorker();
    const client = createWorkerClient<FakeMethods>(fake as unknown as Worker);
    fake.emitError('boom');
    await expect(client.call('m', 1)).rejects.toThrow();
  });
});
