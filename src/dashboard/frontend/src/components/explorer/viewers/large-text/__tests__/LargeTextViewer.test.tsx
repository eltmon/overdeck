/** PAN-5188 WI-8: the large-text viewer drives its indexing worker and renders pages; tables render from text. */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TextPreviewRequest, TextPreviewResult } from '../largeTextProtocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly posted: TextPreviewRequest[] = [];
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
  removeEventListener() {}
  postMessage(message: TextPreviewRequest) {
    this.posted.push(message);
  }
  terminate() {}
  emit(data: TextPreviewResult) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data } as MessageEvent);
  }
}

const sizeDescriptors = ['clientWidth', 'clientHeight'] as const;

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  for (const key of sizeDescriptors) {
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => 800 });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of sizeDescriptors) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
});

describe('LargeTextViewer', () => {
  it('opens the worker with src and renders the first indexed row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ignored', { status: 200 })));
    const { default: LargeTextViewer } = await import('../LargeTextViewer');
    render(<LargeTextViewer name="big.log" src="/api/explorer/download?path=big.log" sizeBytes={30} delimiter={null} />);

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0]!;
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.posted[0]).toMatchObject({ type: 'open', src: '/api/explorer/download?path=big.log', delimiter: null });

    act(() => {
      worker.emit({ type: 'meta', count: 3, columns: 1, complete: true, sizeBytes: 30 });
      worker.emit({ type: 'page', index: 0, rows: [['first line'], ['second line'], ['third line']] });
    });
    expect(await screen.findByText('first line')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('3 lines');
  });
});

describe('DelimitedTablePreview', () => {
  it('renders the cells of a small CSV from text', async () => {
    const { DelimitedTablePreview } = await import('../DelimitedTablePreview');
    render(<DelimitedTablePreview name="t.csv" text={'a,b\n1,2'} delimiter="," />);
    for (const cell of ['a', 'b', '1', '2']) {
      expect((await screen.findAllByText(cell)).length).toBeGreaterThan(0);
    }
  });
});
