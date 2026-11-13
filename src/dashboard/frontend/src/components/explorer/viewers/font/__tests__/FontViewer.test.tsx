/** PAN-5188 WI-7: the font viewer validates the font and shows a sandboxed specimen. */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FontViewer from '../FontViewer';

let load: ReturnType<typeof vi.fn>;

beforeEach(() => {
  load = vi.fn(async () => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0, 1, 0, 0]), { status: 200 })));
  vi.stubGlobal(
    'FontFace',
    class {
      load = load;
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FontViewer', () => {
  it('renders the specimen in an iframe with an empty sandbox', async () => {
    render(<FontViewer src="/api/explorer/download?root=r&path=a.woff2&inline=1" name="a.woff2" />);
    const frame = await screen.findByTitle('a.woff2');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain("font-src data:");
  });

  it('shows the failure text when the font does not load', async () => {
    load.mockRejectedValueOnce(new Error('bad font'));
    render(<FontViewer src="/x.ttf" name="x.ttf" />);
    expect((await screen.findByRole('alert')).textContent).toContain('bad font');
  });

  it('gives up after 30 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    render(<FontViewer src="/slow.ttf" name="slow.ttf" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole('alert').textContent).toContain('took too long');
  });
});
