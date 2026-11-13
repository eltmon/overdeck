/** PAN-5188 WI-13: FileViewer lazy-loads the chosen viewer with download URLs built from the read. */
import { render, screen } from '@testing-library/react';
import type { ExplorerReadFileResult } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../image/ImageViewer', () => ({
  default: (props: { src: string }) => <div data-testid="image-viewer" data-src={props.src} />,
}));
vi.mock('../binary/BinaryViewer', () => ({
  default: (props: { kind: string }) => <div data-testid="archive-viewer" data-kind={props.kind} />,
}));
vi.mock('../pdf/PdfViewer', () => ({ default: () => <div data-testid="pdf-viewer" /> }));

const { default: FileViewer } = await import('../FileViewer');

function read(kind: ExplorerReadFileResult['kind'], signature = 'sig-1-9'): ExplorerReadFileResult {
  return { kind, size: 2048, mtimeMs: 1, signature, lang: 'plaintext', writable: true };
}

describe('FileViewer', () => {
  it('renders the image viewer with an inline src carrying the signature as rev', async () => {
    render(<FileViewer rootId="issue:PAN-1" path="img/a.png" read={read('binary')} />);
    const src = (await screen.findByTestId('image-viewer')).getAttribute('data-src')!;
    expect(src).toContain('inline=1');
    expect(src).toContain('rev=sig-1-9');
    expect(src).toContain('path=img%2Fa.png');
  });

  it('renders the archive viewer for a zip', async () => {
    render(<FileViewer rootId="issue:PAN-1" path="a.zip" read={read('binary')} />);
    expect((await screen.findByTestId('archive-viewer')).getAttribute('data-kind')).toBe('archive');
  });

  it('renders the binary card with an attachment download link for an unknown binary', async () => {
    render(<FileViewer rootId="issue:PAN-1" path="blob.xyz" read={read('binary')} />);
    const link = await screen.findByRole('link', { name: /download/i });
    expect(link.getAttribute('href')).toContain('inline=0');
  });

  it('renders nothing for a text read', () => {
    const { container } = render(<FileViewer rootId="issue:PAN-1" path="a.ts" read={read('text')} />);
    expect(container.innerHTML).toBe('');
  });
});
