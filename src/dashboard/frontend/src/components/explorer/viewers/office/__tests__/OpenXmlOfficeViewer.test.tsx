/** PAN-5189 WI-10: OpenXmlOfficeViewer opens the office preview worker and renders the engine, the truncated notice, or the download card. */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../engine/WordDocument', () => ({
  default: () => <div data-testid="word-document" />,
}));

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
  emit(data: unknown) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data } as MessageEvent);
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(8), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function openedWorker() {
  await vi.waitFor(() => expect(FakeWorker.instances[0]?.posted.length).toBeGreaterThan(0));
  return FakeWorker.instances[0]!;
}

describe('OpenXmlOfficeViewer', () => {
  it('posts an open request with the fetched bytes transferred', async () => {
    const { default: OpenXmlOfficeViewer } = await import('../OpenXmlOfficeViewer');
    render(
      <OpenXmlOfficeViewer
        src="/api/explorer/download?path=a.docx"
        name="a.docx"
        kind="docx"
        size={8}
        downloadUrl="/api/explorer/download?path=a.docx"
      />,
    );
    const worker = await openedWorker();
    const { message, transfer } = worker.posted[0]!;
    expect(message).toMatchObject({ type: 'open', kind: 'docx' });
    expect(transfer).toHaveLength(1);
  });

  it('renders the Word marker and the truncated notice', async () => {
    const { default: OpenXmlOfficeViewer } = await import('../OpenXmlOfficeViewer');
    render(
      <OpenXmlOfficeViewer
        src="/api/explorer/download?path=a.docx"
        name="a.docx"
        kind="docx"
        size={8}
        downloadUrl="/api/explorer/download?path=a.docx"
      />,
    );
    const worker = await openedWorker();
    act(() => {
      worker.emit({ type: 'docx', bytes: new ArrayBuffer(8), truncated: true, view: undefined });
    });
    expect(await screen.findByTestId('word-document')).toBeTruthy();
    expect(
      await screen.findByText('Preview limited. Download the file to read all of it.'),
    ).toBeTruthy();
  });

  it('renders the download card and the error message on failure', async () => {
    const { default: OpenXmlOfficeViewer } = await import('../OpenXmlOfficeViewer');
    render(
      <OpenXmlOfficeViewer
        src="/api/explorer/download?path=a.docx"
        name="a.docx"
        kind="docx"
        size={8}
        downloadUrl="/api/explorer/download?path=a.docx"
      />,
    );
    const worker = await openedWorker();
    act(() => {
      worker.emit({ type: 'error', message: 'Damaged' });
    });
    expect(await screen.findByText('Damaged')).toBeTruthy();
    expect(screen.getByRole('link', { name: /download/i })).toBeTruthy();
  });

  it('shows a timeout message after 30 seconds with no reply', async () => {
    vi.useFakeTimers();
    // The fetch never resolves, so only the component's own 30 s timeout can produce the failure.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { default: OpenXmlOfficeViewer } = await import('../OpenXmlOfficeViewer');
    render(
      <OpenXmlOfficeViewer
        src="/api/explorer/download?path=a.docx"
        name="a.docx"
        kind="docx"
        size={8}
        downloadUrl="/api/explorer/download?path=a.docx"
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText(/This document took too long to preview/)).toBeTruthy();
  });

  it('renders the binary card without fetching when size exceeds 50 MB', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { default: OpenXmlOfficeViewer } = await import('../OpenXmlOfficeViewer');
    render(
      <OpenXmlOfficeViewer
        src="/api/explorer/download?path=a.docx"
        name="a.docx"
        kind="docx"
        size={51 * 1024 * 1024}
        downloadUrl="/api/explorer/download?path=a.docx"
      />,
    );
    expect(await screen.findByText('Preview limited to files under 50 MB.')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
