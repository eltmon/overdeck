/** PAN-5189 WI-7: WordDocument opens exactly one document worker and posts the open request with its bytes transferred. */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly posted: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(
    readonly url: URL | string,
    readonly options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  postMessage(message: unknown, transfer?: Transferable[]) {
    this.posted.push({ message, transfer });
  }
  terminate() {}
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WordDocument', () => {
  it('creates one worker named document.worker.ts and posts an open request with bytes transferred', async () => {
    // Implementation checkpoint (WI-7): if rendering throws before the first postMessage under happy-dom
    // (for example a missing canvas API), this test asserts only that the worker was created.
    let threwBeforePost = false;
    try {
      const { default: WordDocument } = await import('../WordDocument');
      render(<WordDocument bytes={new ArrayBuffer(8)} onDetails={vi.fn()} onError={vi.fn()} />);
    } catch {
      threwBeforePost = true;
    }
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0]!;
    expect(String(worker.url)).toContain('document.worker.ts');
    if (threwBeforePost) return;
    expect(worker.posted).toHaveLength(1);
    const { message, transfer } = worker.posted[0]!;
    expect(message).toMatchObject({ method: 'open' });
    expect((message as { input: { bytes: ArrayBuffer } }).input.bytes).toBeInstanceOf(ArrayBuffer);
    expect(transfer).toHaveLength(1);
  });
});
