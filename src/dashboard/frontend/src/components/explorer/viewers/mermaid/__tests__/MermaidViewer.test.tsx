/** PAN-5189 WI-12m: MermaidViewer renders a diagram as an SVG image, guards unsafe source, and falls back on parse errors. */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const initialize = vi.fn();
let render_: ReturnType<typeof vi.fn>;

vi.mock('mermaid', () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (...args: unknown[]) => render_(...args),
  },
}));

afterEach(() => {
  initialize.mockClear();
});

describe('MermaidViewer', () => {
  it('renders an SVG image and initializes mermaid with securityLevel strict', async () => {
    render_ = vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
    const { default: MermaidViewer } = await import('../MermaidViewer');
    render(
      <MermaidViewer
        text="graph TD; A-->B"
        name="a.mmd"
        size={10}
        downloadUrl="/api/explorer/download?path=a.mmd"
      />,
    );
    const img = await screen.findByRole('img');
    expect(img.getAttribute('src')?.startsWith('data:image/svg+xml')).toBe(true);
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict' }));
  });

  it('shows the guard notice and never calls render for %%{init source', async () => {
    render_ = vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
    const { default: MermaidViewer } = await import('../MermaidViewer');
    render(
      <MermaidViewer
        text={'%%{init: {"theme":"forest"}}%%\ngraph TD; A-->B'}
        name="a.mmd"
        size={10}
        downloadUrl="/api/explorer/download?path=a.mmd"
      />,
    );
    expect(
      await screen.findByText(/resource URLs, markup, node metadata, or custom configuration/),
    ).toBeTruthy();
    expect(render_).not.toHaveBeenCalled();
  });

  it('shows the guard notice for embedded markup', async () => {
    render_ = vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
    const { default: MermaidViewer } = await import('../MermaidViewer');
    render(
      <MermaidViewer
        text="graph TD; A[<img src=x>]"
        name="a.mmd"
        size={10}
        downloadUrl="/api/explorer/download?path=a.mmd"
      />,
    );
    expect(
      await screen.findByText(/resource URLs, markup, node metadata, or custom configuration/),
    ).toBeTruthy();
    expect(render_).not.toHaveBeenCalled();
  });

  it('renders a download card and the message when render rejects', async () => {
    render_ = vi.fn(async () => {
      throw new Error('Parse error on line 1');
    });
    const { default: MermaidViewer } = await import('../MermaidViewer');
    render(
      <MermaidViewer
        text="graph TD; A-->B"
        name="a.mmd"
        size={10}
        downloadUrl="/api/explorer/download?path=a.mmd"
      />,
    );
    expect(await screen.findByText('Parse error on line 1')).toBeTruthy();
    expect(screen.getByRole('link', { name: /download/i })).toBeTruthy();
  });
});
