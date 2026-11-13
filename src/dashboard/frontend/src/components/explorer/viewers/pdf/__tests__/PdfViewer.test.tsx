/** PAN-5188 WI-9: the PDF viewer opens a document and enforces the 2,000-page limit. */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  TextLayer: class {
    render() {
      return Promise.resolve();
    }
    cancel() {}
  },
}));

const openPdf = vi.fn();
vi.mock('../pdfDocument', () => ({ openPdf: (bytes: ArrayBuffer) => openPdf(bytes) }));

function fakeDocument(numPages: number) {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale, scale }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
    streamTextContent: () => new ReadableStream(),
    getTextContent: async () => ({ items: [] }),
    cleanup() {},
  };
  return { numPages, getPage: vi.fn(async () => page) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  openPdf.mockReset();
});

describe('PdfViewer', () => {
  it('shows the page count of the opened document', async () => {
    openPdf.mockReturnValue({ promise: Promise.resolve(fakeDocument(3)), destroy: vi.fn() });
    const { default: PdfViewer } = await import('../PdfViewer');
    render(<PdfViewer src="/api/explorer/download?path=a.pdf" title="a.pdf" />);
    expect(await screen.findByText('1 / 3 pages')).toBeTruthy();
    expect(openPdf).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });

  it('refuses a document over 2,000 pages', async () => {
    openPdf.mockReturnValue({ promise: Promise.resolve(fakeDocument(2001)), destroy: vi.fn() });
    const { default: PdfViewer } = await import('../PdfViewer');
    render(<PdfViewer src="/api/explorer/download?path=huge.pdf" title="huge.pdf" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Preview limited to 2,000 pages');
  });
});
