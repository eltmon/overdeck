import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useChannelMediaSrc } from '../useChannelMediaSrc';

// PAN-4834 CP-2: in the phone app, machine `/api/…` images load through the channel via fetch.

const flag = globalThis as { __OVERDECK_NATIVE__?: boolean };
const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => 'blob:capacitor://localhost/object-1');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  flag.__OVERDECK_NATIVE__ = true;
  fetchMock.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
});

afterEach(() => {
  delete flag.__OVERDECK_NATIVE__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useChannelMediaSrc', () => {
  it('returns the URL unchanged outside the native shell without fetching', () => {
    delete flag.__OVERDECK_NATIVE__;
    const { result } = renderHook(() => useChannelMediaSrc('/api/x.png'));
    expect(result.current).toBe('/api/x.png');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns undefined for an empty URL', () => {
    expect(renderHook(() => useChannelMediaSrc(undefined)).result.current).toBeUndefined();
    expect(renderHook(() => useChannelMediaSrc('')).result.current).toBeUndefined();
  });

  it('loads a native /api/ image through fetch into an object URL', async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(['png']), { status: 200 }));
    const { result } = renderHook(() => useChannelMediaSrc('/api/x.png'));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe('blob:capacitor://localhost/object-1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/x.png');
  });

  it('falls back to the original URL on a 404', async () => {
    fetchMock.mockResolvedValue(new Response('missing', { status: 404 }));
    const { result } = renderHook(() => useChannelMediaSrc('/api/x.png'));
    await waitFor(() => expect(result.current).toBe('/api/x.png'));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('falls back to the original URL when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useChannelMediaSrc('/api/x.png'));
    await waitFor(() => expect(result.current).toBe('/api/x.png'));
  });

  it('leaves an external URL alone in the native shell', () => {
    const { result } = renderHook(() => useChannelMediaSrc('https://example.com/a.png'));
    expect(result.current).toBe('https://example.com/a.png');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('revokes the object URL on unmount', async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(['png']), { status: 200 }));
    const { result, unmount } = renderHook(() => useChannelMediaSrc('/api/x.png'));
    await waitFor(() => expect(result.current).toBe('blob:capacitor://localhost/object-1'));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:capacitor://localhost/object-1');
  });

  it('revokes the previous object URL when the URL changes', async () => {
    fetchMock.mockImplementation(async () => new Response(new Blob(['png']), { status: 200 }));
    createObjectURL.mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two');
    const { result, rerender } = renderHook(({ url }) => useChannelMediaSrc(url), { initialProps: { url: '/api/1.png' } });
    await waitFor(() => expect(result.current).toBe('blob:one'));
    rerender({ url: '/api/2.png' });
    expect(result.current).toBeUndefined();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:one');
    await waitFor(() => expect(result.current).toBe('blob:two'));
  });
});
