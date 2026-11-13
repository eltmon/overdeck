/** PAN-5189 WI-11: the ODF viewer opens the office preview worker and renders documents, sheets or the download card. */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../DocumentPages', () => ({
  default: (props: { html: string }) => (
    <div data-testid="document-pages" data-html={props.html} />
  ),
}));

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly posted: unknown[] = [];
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
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  terminate() {}
  emit(data: unknown) {
    for (const listener of this.listeners.get('message') ?? []) listener({ data } as MessageEvent);
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openedWorker() {
  await vi.waitFor(() => expect(FakeWorker.instances[0]?.posted.length).toBeGreaterThan(0));
  return FakeWorker.instances[0]!;
}

describe('OdfViewer', () => {
  it('posts an open request for the odt kind', async () => {
    const { default: OdfViewer } = await import('../OdfViewer');
    render(
      <OdfViewer
        src="/api/explorer/download?path=a.odt"
        name="a.odt"
        kind="odt"
        size={4}
        downloadUrl="/api/explorer/download?path=a.odt"
      />,
    );
    const worker = await openedWorker();
    expect(worker.posted[0]).toMatchObject({ type: 'open', kind: 'odt' });
  });

  it('renders the DocumentPages marker for a document reply', async () => {
    const { default: OdfViewer } = await import('../OdfViewer');
    render(
      <OdfViewer
        src="/api/explorer/download?path=a.odt"
        name="a.odt"
        kind="odt"
        size={4}
        downloadUrl="/api/explorer/download?path=a.odt"
      />,
    );
    const worker = await openedWorker();
    act(() => {
      worker.emit({
        type: 'document',
        navigation: 'page',
        pages: [{ title: 'P1', html: '<p>x</p>' }],
      });
    });
    expect(await screen.findByTestId('document-pages')).toBeTruthy();
  });

  it('renders a select of sheet names for an ods reply', async () => {
    const { default: OdfViewer } = await import('../OdfViewer');
    render(
      <OdfViewer
        src="/api/explorer/download?path=a.ods"
        name="a.ods"
        kind="ods"
        size={4}
        downloadUrl="/api/explorer/download?path=a.ods"
      />,
    );
    const worker = await openedWorker();
    act(() => {
      worker.emit({
        type: 'ods',
        sheets: [{ name: 'S1', rows: [['a']], truncated: false, rowCount: 1, columns: 1 }],
      });
    });
    expect(await screen.findByRole('option', { name: 'S1' })).toBeTruthy();
  });

  it('renders the download card for an error reply', async () => {
    const { default: OdfViewer } = await import('../OdfViewer');
    render(
      <OdfViewer
        src="/api/explorer/download?path=a.odt"
        name="a.odt"
        kind="odt"
        size={4}
        downloadUrl="/api/explorer/download?path=a.odt"
      />,
    );
    const worker = await openedWorker();
    act(() => {
      worker.emit({ type: 'error', message: 'Damaged' });
    });
    expect(await screen.findByText('Damaged')).toBeTruthy();
    expect(screen.getByRole('link', { name: /download/i })).toBeTruthy();
  });
});
