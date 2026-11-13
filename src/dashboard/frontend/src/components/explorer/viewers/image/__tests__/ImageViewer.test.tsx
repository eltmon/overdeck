/** PAN-5188 WI-10: the image viewer shows native formats, SVG as data:, decodes TIFF and falls back for HEIC. */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const decodeImagePreview = vi.fn();
vi.mock('../decodeImagePreview', () => ({
  decodeImagePreview: (src: string, signal: AbortSignal) => decodeImagePreview(src, signal),
}));

const { default: ImageViewer, HEIC_NOTICE } = await import('../ImageViewer');

const props = (name: string) => ({
  src: `/api/explorer/download?path=${name}&inline=1`,
  name,
  size: 2048,
  downloadUrl: `/api/explorer/download?path=${name}&inline=0`,
});

afterEach(() => {
  vi.unstubAllGlobals();
  decodeImagePreview.mockReset();
});

describe('ImageViewer', () => {
  it('renders an img with the given src', () => {
    render(<ImageViewer {...props('a.png')} />);
    expect(screen.getByRole('img', { name: 'a.png' }).getAttribute('src')).toBe(props('a.png').src);
  });

  it('shows an SVG through a base64 data: URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200 })));
    render(<ImageViewer {...props('icon.svg')} svg />);
    const img = await screen.findByRole('img', { name: 'icon.svg' });
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/u);
  });

  it('falls back to the binary card with the HEIC notice', async () => {
    render(<ImageViewer {...props('photo.heic')} />);
    fireEvent.error(screen.getByRole('img', { name: 'photo.heic' }));
    expect(await screen.findByText(HEIC_NOTICE)).toBeTruthy();
    expect(screen.getByRole('link', { name: /download/i }).getAttribute('href')).toBe(props('photo.heic').downloadUrl);
  });

  it('decodes a TIFF the browser cannot show into a blob: URL', async () => {
    decodeImagePreview.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:decoded');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { unmount } = render(<ImageViewer {...props('scan.tiff')} />);
    fireEvent.error(screen.getByRole('img', { name: 'scan.tiff' }));
    await vi.waitFor(() => expect(screen.getByRole('img', { name: 'scan.tiff' }).getAttribute('src')).toBe('blob:decoded'));
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:decoded');
    create.mockRestore();
    revoke.mockRestore();
    expect(decodeImagePreview).toHaveBeenCalledWith(props('scan.tiff').src, expect.any(AbortSignal));
  });
});
