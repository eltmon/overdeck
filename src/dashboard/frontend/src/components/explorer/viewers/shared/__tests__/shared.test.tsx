/** PAN-5188 WI-6b: shared viewer helpers — bounded reads, binary card, stable callbacks, size text. */
import { render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BinaryCard } from '../BinaryCard';
import { formatSize } from '../formatSize';
import { readBinaryPreview, readBounded } from '../readBounded';
import { useLatestCallback } from '../useLatestCallback';
import { ViewerAction, ViewerFailure } from '../ViewerChrome';

function twoChunkResponse(first: number, second: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(first));
      controller.enqueue(new Uint8Array(second));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readBounded', () => {
  it('rejects when the streamed body passes the limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => twoChunkResponse(6, 6)));
    await expect(readBounded('/x', new AbortController().signal, 10)).rejects.toThrow('too large');
  });

  it('resolves the bytes when the body stays under the limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => twoChunkResponse(3, 4)));
    const bytes = await readBounded('/x', new AbortController().signal, 10);
    expect(bytes.byteLength).toBe(7);
  });

  it('readBinaryPreview applies its limit the same way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => twoChunkResponse(6, 6)));
    await expect(readBinaryPreview('/x', new AbortController().signal, 10)).rejects.toThrow('Preview limited');
  });
});

describe('BinaryCard', () => {
  it('shows the size and a download link', () => {
    render(<BinaryCard name="blob.bin" size={1536} downloadUrl="/api/explorer/download?root=r&path=blob.bin&inline=0" />);
    expect(screen.getByText('2 KB')).toBeTruthy();
    const link = screen.getByRole('link', { name: /download/i });
    expect(link.getAttribute('href')).toBe('/api/explorer/download?root=r&path=blob.bin&inline=0');
    expect(link.getAttribute('download')).toBe('blob.bin');
  });
});

describe('useLatestCallback', () => {
  it('keeps one function identity and calls the newest closure', () => {
    const { result, rerender } = renderHook(({ value }) => useLatestCallback(() => value), {
      initialProps: { value: 1 },
    });
    const first = result.current;
    rerender({ value: 2 });
    expect(result.current).toBe(first);
    expect(result.current()).toBe(2);
  });
});

describe('formatSize', () => {
  it('prints KB and MB like t3code', () => {
    expect(formatSize(1536)).toBe('2 KB');
    expect(formatSize(1572864)).toBe('1.5 MB');
  });
});

describe('ViewerChrome', () => {
  it('renders an action without an app-level tooltip provider and calls onClick', () => {
    const onClick = vi.fn();
    render(<ViewerAction label="Zoom in" onClick={onClick} pressed={false} />);
    const button = screen.getByRole('button', { name: 'Zoom in' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('offers a retry on failure', () => {
    const onRetry = vi.fn();
    render(<ViewerFailure message="It broke" onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('It broke');
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
