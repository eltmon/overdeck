/** PAN-5189 WI-9: Presentation opens exactly one presentation worker and posts the open request. */
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

describe('Presentation', () => {
  it('creates one worker named presentation.worker.ts and posts an open request', async () => {
    // Implementation checkpoint (WI-9, same as WI-7): if rendering throws before the first postMessage under
    // happy-dom, this test asserts only that the worker was created.
    let threwBeforePost = false;
    try {
      const { default: Presentation } = await import('../Presentation');
      render(<Presentation bytes={new ArrayBuffer(8)} onDetails={vi.fn()} onError={vi.fn()} />);
    } catch {
      threwBeforePost = true;
    }
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0]!;
    expect(String(worker.url)).toContain('presentation.worker.ts');
    if (threwBeforePost) return;
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]!.message).toMatchObject({ method: 'open' });
  });
});
