/** PAN-5188 WI-12: the archive and SQLite viewer hands bytes to its worker and renders the answers. */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinaryWorkerRequest, BinaryWorkerResult } from '../binaryPreviewProtocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly posted: Array<{ message: BinaryWorkerRequest; transfer?: Transferable[] }> = [];
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
  postMessage(message: BinaryWorkerRequest, transfer?: Transferable[]) {
    this.posted.push({ message, transfer });
  }
  terminate() {}
  emit(data: BinaryWorkerResult) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data } as MessageEvent);
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0x50, 0x4b, 5, 6]), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openedWorker() {
  await vi.waitFor(() => expect(FakeWorker.instances[0]?.posted.length).toBeGreaterThan(0));
  return FakeWorker.instances[0]!;
}

describe('BinaryViewer', () => {
  it('transfers the fetched bytes and lists archive entries', async () => {
    const { default: BinaryViewer } = await import('../BinaryViewer');
    render(<BinaryViewer src="/api/explorer/download?path=a.zip" name="a.zip" kind="archive" />);
    const worker = await openedWorker();
    const { message, transfer } = worker.posted[0]!;
    expect(message).toMatchObject({ type: 'open', kind: 'archive', name: 'a.zip' });
    expect(message.type === 'open' && message.bytes.byteLength).toBe(4);
    expect(transfer).toHaveLength(1);

    act(() => {
      worker.emit({
        type: 'archive',
        entries: [
          { path: 'a.txt', size: 5, modified: null, directory: false },
          { path: 'dir/', size: 0, modified: null, directory: true },
        ],
      });
    });
    expect(await screen.findByText('a.txt')).toBeTruthy();
    expect(screen.getByText('dir')).toBeTruthy();
  });

  it('shows the tables of a SQLite database', async () => {
    const { default: BinaryViewer } = await import('../BinaryViewer');
    render(<BinaryViewer src="/api/explorer/download?path=app.db" name="app.db" kind="sqlite" />);
    const worker = await openedWorker();
    act(() => {
      worker.emit({ type: 'sqlite', tables: [{ name: 'users', count: 2 }] });
    });
    expect((await screen.findByRole('option')).textContent).toContain('users');
    expect(worker.posted.at(-1)!.message).toEqual({ type: 'rows', table: 'users', page: 0 });
  });
});
