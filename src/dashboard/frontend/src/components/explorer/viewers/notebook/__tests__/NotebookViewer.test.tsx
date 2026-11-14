/** PAN-5189 WI-12: NotebookViewer fetches and renders a notebook inertly, or falls back to the download card. */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubFetch(body: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new TextEncoder().encode(body), { status: 200 })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotebookViewer', () => {
  beforeEach(() => {
    stubFetch(
      JSON.stringify({
        nbformat: 4,
        metadata: {},
        cells: [
          { cell_type: 'markdown', source: '![x](https://e.com/t.png) [link](https://e.com)' },
          { cell_type: 'code', source: 'print(1)' },
        ],
      }),
    );
  });

  it('renders no img or a elements for markdown, keeping the link text', async () => {
    const { default: NotebookViewer } = await import('../NotebookViewer');
    render(
      <NotebookViewer
        src="/api/explorer/download?path=a.ipynb"
        name="a.ipynb"
        size={4}
        downloadUrl="/api/explorer/download?path=a.ipynb"
      />,
    );
    expect(await screen.findByText('link', { exact: false })).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a code cell inside a pre element', async () => {
    const { default: NotebookViewer } = await import('../NotebookViewer');
    const { container } = render(
      <NotebookViewer
        src="/api/explorer/download?path=a.ipynb"
        name="a.ipynb"
        size={4}
        downloadUrl="/api/explorer/download?path=a.ipynb"
      />,
    );
    await screen.findByText('link', { exact: false });
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('print(1)');
  });

  it('shows the saved-outputs-only notice', async () => {
    const { default: NotebookViewer } = await import('../NotebookViewer');
    render(
      <NotebookViewer
        src="/api/explorer/download?path=a.ipynb"
        name="a.ipynb"
        size={4}
        downloadUrl="/api/explorer/download?path=a.ipynb"
      />,
    );
    expect(await screen.findByText('Saved outputs only. Code is never executed.')).toBeTruthy();
  });

  it('renders no link elements for GFM footnotes', async () => {
    stubFetch(
      JSON.stringify({
        nbformat: 4,
        metadata: {},
        cells: [{ cell_type: 'markdown', source: 'See note[^1].\n\n[^1]: a footnote body' }],
      }),
    );
    const { default: NotebookViewer } = await import('../NotebookViewer');
    render(
      <NotebookViewer
        src="/api/explorer/download?path=a.ipynb"
        name="a.ipynb"
        size={4}
        downloadUrl="/api/explorer/download?path=a.ipynb"
      />,
    );
    expect(await screen.findByText('See note', { exact: false })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a download card when the body is not JSON', async () => {
    stubFetch('not json');
    const { default: NotebookViewer } = await import('../NotebookViewer');
    render(
      <NotebookViewer
        src="/api/explorer/download?path=a.ipynb"
        name="a.ipynb"
        size={4}
        downloadUrl="/api/explorer/download?path=a.ipynb"
      />,
    );
    expect(await screen.findByRole('link', { name: /download/i })).toBeTruthy();
  });
});
