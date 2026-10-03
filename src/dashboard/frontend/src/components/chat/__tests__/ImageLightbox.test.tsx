import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

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
});
