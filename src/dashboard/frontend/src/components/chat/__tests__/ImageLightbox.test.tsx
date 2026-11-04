import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ImageLightboxHost, openImageLightbox, useImageLightboxStore } from '../ImageLightbox';

// PAN-4493 WI-2: a single shared full-size viewer for a pasted/sent image.

afterEach(() => {
  act(() => useImageLightboxStore.getState().close());
});

describe('ImageLightbox', () => {
  it('renders nothing until opened', () => {
    render(<ImageLightboxHost />);
    expect(screen.queryByTestId('image-lightbox')).toBeNull();
  });

  it('renders the image after openImageLightbox', () => {
    render(<ImageLightboxHost />);
    act(() => openImageLightbox('/api/conversations/conv-a/attachments/a.png', 'a.png'));
    const dialog = screen.getByTestId('image-lightbox');
    expect(dialog).not.toBeNull();
    const img = screen.getByAltText('a.png') as HTMLImageElement;
    expect(img.src).toContain('/api/conversations/conv-a/attachments/a.png');
  });

  it('closes on Escape', () => {
    render(<ImageLightboxHost />);
    act(() => openImageLightbox('/a.png', 'a.png'));
    expect(screen.queryByTestId('image-lightbox')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('image-lightbox')).toBeNull();
  });

  it('closes on a backdrop click', () => {
    render(<ImageLightboxHost />);
    act(() => openImageLightbox('/a.png', 'a.png'));
    fireEvent.click(screen.getByTestId('image-lightbox'));
    expect(screen.queryByTestId('image-lightbox')).toBeNull();
  });

  it('stays open on an image click', () => {
    render(<ImageLightboxHost />);
    act(() => openImageLightbox('/a.png', 'a.png'));
    fireEvent.click(screen.getByAltText('a.png'));
    expect(screen.queryByTestId('image-lightbox')).not.toBeNull();
  });

  it('loads a machine image through fetch into an object URL in the native shell', async () => {
    // PAN-4834 CP-2: the <img> would bypass the channel shims, so the phone app fetches it.
    const flag = globalThis as { __OVERDECK_NATIVE__?: boolean };
    flag.__OVERDECK_NATIVE__ = true;
    const fetchMock = vi.fn(async () => new Response(new Blob(['png']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:capacitor://localhost/lightbox');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      render(<ImageLightboxHost />);
      act(() => openImageLightbox('/api/conversations/c/attachments/a.png', 'a'));
      const img = screen.getByAltText('a') as HTMLImageElement;
      await waitFor(() => expect(img.getAttribute('src')).toBe('blob:capacitor://localhost/lightbox'));
      expect(fetchMock).toHaveBeenCalledWith('/api/conversations/c/attachments/a.png');
    } finally {
      delete flag.__OVERDECK_NATIVE__;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
